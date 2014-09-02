'use strict';

var Promise = require('bluebird');
var crypto = require('crypto');
var _ = require('lodash');

exports.wrap = function(Collection) {

	if (Collection.prototype.__is_wrapped__)
	{
		return; //don't re-wrap Collection. bad things happen.
	}
	ensurePromisifiedCursor(Collection, 'find');
	ensurePromisifiedCursor(Collection, 'aggregate');

	Collection.prototype.cachedAggregate = cachedAggregate;
	Collection.prototype.cachedMapReduce = cachedMapReduce;

	Promise.promisifyAll(Collection.prototype);
	Collection.prototype.__is_wrapped__ = true;
};

/**
 * Magical Jar of Science™
 *
 * Given a Collection, and a name of a function on that Collection's prototype...
 * this will wrap that function with a new function that, when called, will call 
 * the provided function and then ensure that if the result of the
 * function (whether via return value or callback) is a cursor, it is promisified
 * 
 * @param   {Object}  ClassObj   the Collection 'Class'
 * @param   {string}  funcName   the name of the function on the prototype to wrap
 */
function ensurePromisifiedCursor(ClassObj, funcName) {
	var renamedOrigFunc = '_' + funcName;
	ClassObj.prototype[renamedOrigFunc] = ClassObj.prototype[funcName];
	ClassObj.prototype[funcName] = function() {
		var that = this;
		var args = Array.prototype.slice.call(arguments);
		if (_.isFunction(_.last(args))) //if it's given a callback
		{
			var lastArg = args.pop(); //remove the original
			args.push(function(err, c) {
				c && _.isFunction(c.toArray) && Promise.promisifyAll(c); //if it's a cursor, promisify it
				lastArg.call(null, err, c);
			});
		}
		var cursor = that[renamedOrigFunc].apply(that, args);
		cursor && _.isFunction(cursor.toArray) && Promise.promisifyAll(cursor);
		return cursor;
	};
}

/**
 * Performs a mongo aggregate query, but attempts to find a cached result for the query before running it,
 * then if not, runs the query and stores the result in the cache afterward
 *
 * @param   {Object|string}    cacheOptions    An object containing any of the following keys:
 *                                               - cacheCollectionName: {string} the name of the collection to
 *                                                    use when reading/writing the cached results
 *                                               - forceUpdateCache: {boolean} if true, re-run the query and
 *                                                   update the cache, regardless if a cached entry exists already
 *                                             Or, as syntactic sugar you can just pass the cacheCollectionName in as a string
 *                                             instead of the cacheOptions object.
 *
 * @param   {Array|Object}     pipeline        An object or array containing the aggregation pipeline options.
 *                                               - see http://mongodb.github.io/node-mongodb-native/api-generated/collection.html#aggregate
 *
 * @param   {Object}           options         (optional) An object containing options for the aggregation. See documentation for this, too
 *
 * @param   {Function}         callback        The callback function for when the query completes.
 *                                              - if successful, the result is passed in as the 2nd param to the callback
 */
function cachedAggregate(/* cacheOptions, pipeline[, options], callback */) {
	//jshint validthis:true
	// -- this function is being set on the prototype of Collection, and will always have valid 'this'
	var origCollection = this;
	var db = this.db;
	var params = parseCacheFuncParams(arguments);
	var argsHash = hashQueryArgs(params.queryArgsArray);
	var cacheCollection = db.collection(params.cacheOptions.cacheCollectionName || 'queryCache');

	cacheCollection.findOneAsync({ queryHash: argsHash })
		.then(function(cacheEntry) {
			if (!_.isEmpty(cacheEntry) && !params.cacheOptions.forceUpdateCache)
			{
				params.callback(null, cacheEntry.cachedResult);
			}
			else
			{
				origCollection.aggregateAsync.apply(origCollection, params.queryArgsArray)
					.then(function(results) {
						saveResultToCache(cacheCollection, argsHash, results, function(err) {
							params.callback(err, results);
						});
					})
					.catch(params.callback);
			}
		})
		.catch(params.callback);
}


/**
 * Performs a mongo mapReduce query, but attempts to find a cached result for the query before running it,
 * then if not, runs the query and stores the resulting collectionName in the cache afterward
 *
 * @param   {Object|string}    cacheOptions    An object containing any of the following keys:
 *                                               - cacheCollectionName: {string} the name of the collection to
 *                                                    use when reading/writing the cached results
 *                                               - forceUpdateCache: {boolean} if true, re-run the query and
 *                                                   update the cache, regardless if a cached entry exists already
 *                                             Or, as syntactic sugar you can just pass the cacheCollectionName in as a string
 *                                             instead of the cacheOptions object.
 *
 * @param   {Function}         map             The map function for the mapReduce
 *                                               - see http://mongodb.github.io/node-mongodb-native/api-generated/collection.html#aggregate
 *
 * @param   {Function}         reduce          The reduce function for the mapReduce
 *                                               - see http://mongodb.github.io/node-mongodb-native/api-generated/collection.html#aggregate
 *
 * @param   {Object}           options         (optional) An object containing options for the mapReduce. See documentation for this, too
 *
 * @param   {Function}         callback        The callback function for when the query completes.
 *                                              - if successful, the result Collection object is passed in as the 2nd param to the callback
 */
function cachedMapReduce(/* cacheOptions, map, reduce[, options], callback */) {
	//jshint validthis:true
	// -- this function is being set on the prototype of Collection, and will always have valid 'this'
	var origCollection = this;
	var db = this.db;
	var params = parseCacheFuncParams(arguments);
	var argsHash = hashQueryArgs(params.queryArgsArray);
	var cacheCollection = db.collection(params.cacheOptions.cacheCollectionName || 'queryCache');
	var usesInlineOutput = params.queryArgsArray[2] && params.queryArgsArray[2].out && params.queryArgsArray[2].out.inline || false;

	cacheCollection.findOneAsync({ queryHash: argsHash })
		.then(function(cacheEntry) {
			if (!_.isEmpty(cacheEntry) && !params.cacheOptions.forceUpdateCache)
			{
				var result = (usesInlineOutput) ? cacheEntry.cachedResult : db.collection(cacheEntry.cachedResult);
				params.callback(null, result);
			}
			else
			{
				origCollection.mapReduceAsync.apply(origCollection, params.queryArgsArray)
					.then(function(result) {
						var resultToCache = usesInlineOutput ? result : (result && result.collectionName);
						saveResultToCache(cacheCollection, argsHash, resultToCache, function(err) {
							params.callback(err, result);
						});
					})
					.catch(params.callback);
			}
		})
		.catch(params.callback);
}


function parseCacheFuncParams(functionArgs) {
	var args = Array.prototype.slice.call(functionArgs);
	var params = { callback: args.pop() };
	params.cacheOptions = (typeof args[0] === 'string') ? { cacheCollectionName: args[0] } : args[0];
	params.queryArgsArray = args.slice(1);
	return params;
}

function hashQueryArgs(argsArray) {
	var argsToHash = _.map(argsArray, function(value) {
		return (typeof value === 'function') ? value.toString() : value; //mapReduce has function args
	});
	var hasher = crypto.createHash('md5');
	hasher.update(JSON.stringify(argsToHash));
	return hasher.digest('base64');
}

function saveResultToCache(cacheCollection, queryHash, resultToCache, callback) {
	cacheCollection.update( //upsert, to ensure we don't add duplicates (e.g., with options.forceUpdateCache)
		{
			queryHash: queryHash
		},
		{
			queryHash: queryHash,
			cachedAt: new Date(),
			cachedResult: resultToCache
		},
		{
			upsert: true
		},
		callback
	);
}
