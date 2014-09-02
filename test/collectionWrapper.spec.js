var Promise = require('bluebird');
var _ = require('lodash');
var mongo = require('mongodb');
var Cursor = mongo.Cursor;
var Collection = mongo.Collection;
var collectionWrapper = require('../src/collectionWrapper');

function getDb() {
	return { 
		serverConfig: { _serverCapabilities: {} },
		databaseName: 'db',
		collection: getCollection
	};
}

function getCollection(opt_collectionName, opt_db) {
	var collectionName = opt_collectionName || 'test';
	var pkFactory = function(){ return new mongo.ObjectId(); };
	return new Collection(opt_db || getDb(), collectionName, pkFactory, { readPreference: 1 });
}

function getCursor(opt_db, opt_collection) {
	return new Cursor(opt_db || getDb(), opt_collection || getCollection());
}

describe('collectionWrapper', function() {

	before(function() {
		collectionWrapper.wrap(Collection);
	});

	it('should call promisifyAll on Collection.prototype', function() {
		expect(Collection.prototype).to.have.deep.property('findAsync.__isPromisified__', true);
	});

	describe('wrapped .find() function', function() {
		var _collection;
		beforeEach(function() {
			_collection = getCollection();
			// we don't want to have it call the real find function, so
			// make it simply return a cursor or call the callback with the cursor
			sinon.stub(_collection, '_find', function() {
				var cb = Array.prototype.slice.call(arguments).pop();
				var cursor = getCursor();
				if (_.isFunction(cb))
				{
					cb(null, cursor);
				}
				return cursor;
			});
		});

		afterEach(function() {
			_collection._find.restore();
		});

		it('should ensure a promisified cursor is returned', function() {
			var resultCursor = _collection.find();
			expect(resultCursor).to.have.deep.property('toArrayAsync.__isPromisified__', true);
		});

		it('should ensure a promisified cursor is passed to the given callback', function() {
			var callback = sinon.stub();
			_collection.find(callback);
			expect(callback).to.have.been.calledOnce;
			expect(callback.args).to.have.deep.property('[0][1].toArrayAsync.__isPromisified__', true);
		});

		it('should pass all the given arguments on to the original find function', function() {
			var query = { someProperty: 'someValue' };
			var options = { skip:1, limit:1, fields: { b: 1 } };
			_collection.find(query, options);
			expect(_collection._find).to.have.been.calledWith(query, options);
		});
	});

	describe('wrapped .aggregate() function', function() {
		var _collection;
		beforeEach(function() {
			_collection = getCollection();
			// we don't want to have it call the real find function, so
			// make it simply return a cursor or call the callback with the cursor
			sinon.stub(_collection, '_aggregate', function() {
				var cb = Array.prototype.slice.call(arguments).pop();
				var cursor = getCursor();
				if (_.isFunction(cb))
				{
					cb(null, cursor);
				}
				return cursor;
			});
		});

		afterEach(function() {
			_collection._aggregate.restore();
		});

		it('should be wrapped to ensure a promisified cursor is returned', function() {
			var resultCursor = _collection.aggregate();
			expect(resultCursor).to.have.deep.property('toArrayAsync.__isPromisified__', true);
		});

		it('should be wrapped to ensure a promisified cursor is passed to the given callback', function() {
			var callback = sinon.stub();
			_collection.aggregate(callback);
			expect(callback).to.have.been.calledOnce;
			expect(callback.args).to.have.deep.property('[0][1].toArrayAsync.__isPromisified__', true);
		});

		it('should pass all the given arguments on to the original aggregate function', function() {
			var query = [ { $match: { things: 'stuff' } } ];
			var options = { explain: true };
			_collection.aggregate(query, options);
			expect(_collection._aggregate).to.have.been.calledWith(query, options);
		});
	});

	describe('augmented with .cachedAggregate() function', function() {
		var _result;
		var _collection;
		var _cacheCollection;
		var _db;
		beforeEach(function() {
			_cacheCollection = getCollection();
			_db = getDb();
			_db.collection = sinon.stub().returns(_cacheCollection);
			_collection = getCollection('test', _db);
			_result = { 'some': 'result' };
			sinon.stub(_collection, 'aggregateAsync', sinon.stub().resolves(_result));
			sinon.stub(_cacheCollection, 'findOneAsync', sinon.stub().resolves(null));
			sinon.stub(_cacheCollection, 'update', sinon.stub().callsArg(3));
		});

		afterEach(function() {
			_collection.aggregateAsync.restore();
			_cacheCollection.findOneAsync.restore();
			_cacheCollection.update.restore();
		});

		it('should also be promisified and provide .cachedAggregateAsync() function', function() {
			expect(_collection).to.have.deep.property('cachedAggregateAsync.__isPromisified__', true);
		});

		it('should accept and use a cacheOptions object as a parameter', function(done) {
			var cacheOptions = { cacheCollectionName: 'testCache' };
			_collection.cachedAggregateAsync(cacheOptions, {})
				.then(function() {
					expect(_db.collection).to.have.been.calledWith(cacheOptions.cacheCollectionName);
					done();
				})
				.catch(done);
		});

		it('should accept and use a cacheCollectionName as a string parameter', function(done) {
			var collectionName = 'testCache';
			_collection.cachedAggregateAsync(collectionName, {})
				.then(function() {
					expect(_db.collection).to.have.been.calledWith(collectionName);
					done();
				})
				.catch(done);
		});

		it('should call the underlying aggregate function and return its result', function(done) {
			_collection.cachedAggregateAsync('test', {})
				.then(function(res) {
					expect(_collection.aggregateAsync).to.have.been.calledOnce;
					expect(res).to.deep.equal(_result);
					done();
				})
				.catch(done);
		});

		it('should always check the cache', function(done) {
			_collection.cachedAggregateAsync('test', {})
				.then(function() {
					expect(_cacheCollection.findOneAsync).to.have.been.calledOnce;
					done();
				})
				.catch(done);
		});

		it('should re-run the query and cache the result on cache misses', function(done) {
			_collection.cachedAggregateAsync('test', {})
				.then(function(res) {
					expect(_cacheCollection.findOneAsync).to.have.been.calledOnce;
					expect(_collection.aggregateAsync).to.have.been.calledOnce;
					expect(_cacheCollection.update).to.have.been.calledOnce;
					expect(res).to.deep.equal(_result);
					done();
				})
				.catch(done);
		});

		it('should not re-run the query, but should return the cached result on cache hits', function(done) {
			_cacheCollection.findOneAsync.restore();
			sinon.stub(_cacheCollection, 'findOneAsync', sinon.stub().resolves({ cachedResult: _result }));
			_collection.cachedAggregateAsync('test', {})
				.then(function(res) {
					expect(_cacheCollection.findOneAsync).to.have.been.calledOnce;
					expect(_collection.aggregateAsync).not.to.have.been.called;
					expect(_cacheCollection.update).not.to.have.been.called;
					expect(res).to.deep.equal(_result);
					done();
				})
				.catch(done);
		});

		it('should re-run the query regardless of cache hit if forceUpdateCache option is given', function(done) {
			_cacheCollection.findOneAsync.restore();
			sinon.stub(_cacheCollection, 'findOneAsync', sinon.stub().resolves({ cachedResult: _result }));
			var cacheOptions = { forceUpdateCache: true, cacheCollectionName: 'testCache' };
			_collection.cachedAggregateAsync(cacheOptions, {})
				.then(function(res) {
					expect(_cacheCollection.findOneAsync).to.have.been.calledOnce;
					expect(_collection.aggregateAsync).to.have.been.calledOnce;
					expect(_cacheCollection.update).to.have.been.calledOnce;
					expect(res).to.deep.equal(_result);
					done();
				})
				.catch(done);
		});
	});

	describe('augmented with .cachedMapReduce() function', function() {
		var _resultCollection;
		var _result;
		var _collection;
		var _cacheCollection;
		var _db;
		beforeEach(function() {
			_cacheCollection = getCollection();
			_db = getDb();
			_resultCollection = getCollection('resultingWordCache');
			_result = ['some', 'inline', 'results'];
			_db.collection = sinon.stub().returns(_cacheCollection);
			_db.collection.withArgs('resultingWordCache').returns(_resultCollection);
			_collection = getCollection('test', _db);
			sinon.stub(_collection, 'mapReduceAsync', sinon.stub().resolves(_resultCollection));
			sinon.stub(_cacheCollection, 'findOneAsync', sinon.stub().resolves(null));
			sinon.stub(_cacheCollection, 'update', sinon.stub().callsArg(3));
		});

		afterEach(function() {
			_collection.mapReduceAsync.restore();
			_cacheCollection.findOneAsync.restore();
			_cacheCollection.update.restore();
		});

		it('should also be promisified and provide .cachedMapReduceAsync() function', function() {
			expect(_collection).to.have.deep.property('cachedMapReduceAsync.__isPromisified__', true);
		});

		it('should accept and use a cacheOptions object as a parameter', function(done) {
			var cacheOptions = { cacheCollectionName: 'testCache' };
			_collection.cachedMapReduceAsync(cacheOptions, {})
				.then(function() {
					expect(_db.collection).to.have.been.calledWith(cacheOptions.cacheCollectionName);
					done();
				})
				.catch(done);
		});

		it('should accept and use a cacheCollectionName as a string parameter', function(done) {
			var collectionName = 'testCache';
			_collection.cachedMapReduceAsync(collectionName, {})
				.then(function() {
					expect(_db.collection).to.have.been.calledWith(collectionName);
					done();
				})
				.catch(done);
		});

		it('should call the underlying mapReduce function and return its result', function(done) {
			_collection.cachedMapReduceAsync('testCache', {})
				.then(function(res) {
					expect(_collection.mapReduceAsync).to.have.been.calledOnce;
					expect(res).to.deep.equal(_resultCollection);
					done();
				})
				.catch(done);
		});

		it('should always check the cache', function(done) {
			_collection.cachedMapReduceAsync('testCache', {})
				.then(function() {
					expect(_cacheCollection.findOneAsync).to.have.been.calledOnce;
					done();
				})
				.catch(done);
		});

		it('should re-run the query and cache the result on cache misses', function(done) {
			_collection.cachedMapReduceAsync('testCache', {})
				.then(function(res) {
					expect(_cacheCollection.findOneAsync).to.have.been.calledOnce;
					expect(_collection.mapReduceAsync).to.have.been.calledOnce;
					expect(_cacheCollection.update).to.have.been.calledOnce;
					expect(res).to.deep.equal(_resultCollection);
					done();
				})
				.catch(done);
		});

		it('should not re-run the query, but should return the cached result on cache hits', function(done) {
			_cacheCollection.findOneAsync.restore();
			sinon.stub(_cacheCollection, 'findOneAsync', sinon.stub().resolves({ cachedResult: _resultCollection.collectionName }));
			_collection.cachedMapReduceAsync('testCache', {})
				.then(function(res) {
					expect(_cacheCollection.findOneAsync).to.have.been.calledOnce;
					expect(_collection.mapReduceAsync).not.to.have.been.called;
					expect(_cacheCollection.update).not.to.have.been.called;
					expect(res).to.deep.equal(_resultCollection);
					done();
				})
				.catch(done);
		});

		it('should re-run the query regardless of cache hit if forceUpdateCache option is given', function(done) {
			_cacheCollection.findOneAsync.restore();
			sinon.stub(_cacheCollection, 'findOneAsync', sinon.stub().resolves({ cachedResult: _resultCollection.collectionName }));
			var cacheOptions = { forceUpdateCache: true, cacheCollectionName: 'testCache' };
			_collection.cachedMapReduceAsync(cacheOptions, {})
				.then(function(res) {
					expect(_cacheCollection.findOneAsync).to.have.been.calledOnce;
					expect(_collection.mapReduceAsync).to.have.been.calledOnce;
					expect(_cacheCollection.update).to.have.been.calledOnce;
					expect(res).to.deep.equal(_resultCollection);
					done();
				})
				.catch(done);
		});

		it('should return the actual results (on cache miss) if inline output is specified', function(done) {
			_collection.mapReduceAsync.restore();
			sinon.stub(_collection, 'mapReduceAsync', sinon.stub().resolves(_result));
			_collection.cachedMapReduceAsync('testCache', null, null, { out: { inline: 1 } })
				.then(function(res) {
					expect(_cacheCollection.findOneAsync).to.have.been.calledOnce;
					expect(_collection.mapReduceAsync).to.have.been.calledOnce;
					expect(_cacheCollection.update).to.have.been.calledOnce;
					expect(res).to.deep.equal(_result);
					done();
				})
				.catch(done);
		});

		it('should return the actual results (on cache hit) if inline output is specified', function(done) {
			_cacheCollection.findOneAsync.restore();
			sinon.stub(_cacheCollection, 'findOneAsync', sinon.stub().resolves({ cachedResult: _result }));
			_collection.cachedMapReduceAsync('testCache', null, null, { out: { inline: 1} })
				.then(function(res) {
					expect(_cacheCollection.findOneAsync).to.have.been.calledOnce;
					expect(_collection.mapReduceAsync).not.to.have.been.called;
					expect(_cacheCollection.update).not.to.have.been.called;
					expect(res).to.deep.equal(_result);
					done();
				})
				.catch(done);
		});
	});
});