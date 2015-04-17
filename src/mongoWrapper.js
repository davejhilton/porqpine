'use strict';

var _ = require('lodash');
var mongo = require('mongodb');
var collectionWrapper = require('./collectionWrapper');
var Promise = require('bluebird');
var MongoClient = mongo.MongoClient;
var Collection = mongo.Collection;
var ObjectId = mongo.ObjectID;
var dbConfig;
var dbPromises = {};

Promise.promisifyAll(MongoClient);
collectionWrapper.wrap(Collection);

exports.setConfig = function(config) {
	if (!config || !_.isPlainObject(config))
	{
		throw new Error('Empty DB Config was passed to mongoWrapper.setConfig()!');
	}
	dbConfig = _.cloneDeep(config);
};

exports.getDb = function(dbNameOrConfig) {
	return new Promise(function(resolve) {
		var dbName;
		var config;
		if (_.isString(dbNameOrConfig))
		{
			if (!dbConfig)
			{
				throw new Error('No dbConfig has been set!');
			}
			dbName = dbNameOrConfig;
			config = dbConfig;
		}
		else if (_.isPlainObject(dbNameOrConfig) && _.isString(dbNameOrConfig.dbName))
		{
			config = dbNameOrConfig;
			dbName = config.dbName;
		}
		else
		{
			throw new Error('Missing or invalid parameter provided to mongo.getDb()');
		}

		if (!dbPromises[dbName] || dbPromises[dbName].isRejected())
		{
			var that = exports;
			dbPromises[dbName] = new Promise(function(innerResolve, innerReject) {
				var conf = _.extend(_.cloneDeep(config), { dbName: dbName });
				var connectionString = that.buildConnectionString(conf);
				var connectionOptions = getConnectionOptions(conf);
				MongoClient.connectAsync(connectionString, connectionOptions)
					.then(function(result) {
						innerResolve(result);
					})
					.catch(function(err){
						innerReject(err);
					});
			});
		}
		resolve(dbPromises[dbName]);
	});
};

exports.close = function(dbName) {
	return new Promise(function(resolve) {
		if (dbPromises[dbName])
		{
			dbPromises[dbName]
				.then(function(db) {
					db.close();
					delete dbPromises[dbName];
					resolve();
				})
				.catch(function() {
					delete dbPromises[dbName];
					resolve();
				});
		}
		else
		{
			resolve();
		}
	});
};

exports.closeAll = function() {
	return Promise.all(_.invoke(_.keys(dbPromises), exports.close));
};

exports.objectId = function(id) {
	return new ObjectId(id);
};

exports.objectIds = function(ids) {
	var mongoIds = [];
	var that = exports;
	ids.forEach(function(id) {
		mongoIds.push(that.objectId(id));
	});
	return mongoIds;
};

//exposed on exports mainly for testing purposes
exports.buildConnectionString = function(conf) {
	var string = 'mongodb://';
	if (conf && conf.user && conf.user.length)
	{
		string += conf.user;
		if (conf.pass && conf.pass.length)
		{
			string += ':' + conf.pass;
		}
		string += '@';
	}

	if (conf && conf.hosts && conf.hosts.length)
	{
		_.each(conf.hosts, function(host, ind) {
			if (ind !== 0)
			{
				string += ',';
			}
			string += host.host;
			if (host.port)
			{
				string += ':' + host.port;
			}
		});
		string += '/';
	}

	string += conf && conf.dbName;

	if (conf && conf.replicaSet)
	{
		string += '?replicaSet=' + conf.replicaSet;
	}

	return string;
};

exports.getMongoInstance = function() {
	return mongo;
};

function getConnectionOptions(conf) {
	return {
		server: {
			socketOptions: {
				connectTimeoutMS: conf.connectTimeoutMS || 1000
			}
		}
	};
}
