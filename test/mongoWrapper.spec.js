
var proxyquire = require('proxyquire').noPreserveCache();
var Promise = require('bluebird');
var mongo;
var connectStub;

describe('Mongo Wrapper', function() {

	beforeEach(function() {
		connectStub = sinon.stub().resolves({});
		reRequireMongoWrapper();
	});

	describe('.buildConnectionString()', function() {

		it('works with just a db name', function() {
			var conString = mongo.buildConnectionString({
				dbName: 'testDbName'
			});
			expect(conString).to.equal('mongodb://testDbName');
		});

		it('works with a single host', function() {
			var conString = mongo.buildConnectionString({
				hosts: [
					{
						host:'testHost.com'
					}
				],
				dbName: 'testDbName'
			});
			expect(conString).to.equal('mongodb://testHost.com/testDbName');
		});

		it('works with a hostname and port', function() {
			var conString = mongo.buildConnectionString({
				hosts: [
					{
						host: 'testHost.com',
						port: 12345
					}
				],
				dbName: 'testDbName'
			});
			expect(conString).to.equal('mongodb://testHost.com:12345/testDbName');
		});

		it('works with multiple hosts and ports', function() {
			var conString = mongo.buildConnectionString({
				hosts: [
					{
						host: 'testHost.com',
						port: 12345
					},
					{
						host: 'testHost2.com',
						port: 67890
					}
				],
				dbName: 'testDbName'
			});
			expect(conString).to.equal('mongodb://testHost.com:12345,testHost2.com:67890/testDbName');
		});

		it('works with multiple hosts and ports and a replicaSet name', function() {
			var conString = mongo.buildConnectionString({
				hosts: [
					{
						host: 'testHost.com',
						port: 12345
					},
					{
						host: 'testHost2.com',
						port: 67890
					}
				],
				replicaSet: 'rs0',
				dbName: 'testDbName'
			});
			expect(conString).to.equal('mongodb://testHost.com:12345,testHost2.com:67890/testDbName?replicaSet=rs0');
		});

		it('works with a user and password', function() {
			var conString = mongo.buildConnectionString({
				user: 'testUser',
				pass: 'testPass',
				dbName: 'testDbName'
			});
			expect(conString).to.equal('mongodb://testUser:testPass@testDbName');
		});

		it('works with all user, pass, hosts, ports, dbName, and replicaSet name', function() {
			var conString = mongo.buildConnectionString({
				user: 'testUser',
				pass: 'testPass',
				hosts: [
					{
						host: 'testHost.com',
						port: 12345
					},
					{
						host: 'testHost2.com',
						port: 67890
					}
				],
				replicaSet: 'rs0',
				dbName: 'testDbName'
			});
			expect(conString).to.equal('mongodb://testUser:testPass@testHost.com:12345,testHost2.com:67890/testDbName?replicaSet=rs0');
		});
	});

	describe('.setConfig()', function() {
		it('should throw an error if no config object is passed in', function() {
			expect(mongo.setConfig).to.throw();
		});

		it('should throw an error if a non-object is passed in', function() {
			expect(mongo.setConfig.bind(mongo, 'config')).to.throw();
		});
	});

	describe('.getDb()', function() {

		beforeEach(function() {
			reRequireMongoWrapper();
			connectStub.returns(Promise.resolve());
		});

		afterEach(function() {
			connectStub.reset();
		});

		it('should accept a string as a dbName if config has been set', function(done) {
			mongo.setConfig({ hosts: ['localhost'] });
			mongo.getDb('someDbName')
				.then(function() {
					expect(connectStub).to.have.been.calledWith(sinon.match('someDbName'));
					done();
				})
				.catch(done);
		});

		it('should throw an error if a string is passed in, but no config has been set', function(done) {
			mongo.getDb('someDbName')
				.then(function() {
					done(new Error('Should not have succeeded because no config was set!'));
				})
				.catch(function(err) {
					done();
				});
		});

		it('should accept a full dbConfig as a parameter and use it', function(done) {
			var config = {
				dbName: 'someDbName',
				hosts: [ { host: 'someHost.com', port: 11111 } ]
			};
			mongo.getDb(config)
				.then(function() {
					expect(connectStub).to.have.been.calledWith(sinon.match('someHost.com:11111/someDbName'));
					done();
				})
				.catch(done);
		});

		it('should require at least a dbName when a full dbConfig is passed in', function(done) {
			var config = {};
			var result = mongo.getDb(config);
			expect(result).to.be.rejected.and.notify(done);
		});

		it('should connect to mongo with the proper connection string', function(done) {
			var dbConfig = {
				user:'testUser',
				pass:'testPass',
				hosts: [
					{
						host: 'testHost.com',
						port: 12345
					},
					{
						host: 'testHost2.com',
						port: 67890
					}
				],
				replicaSet: 'rs0',
				dbName:'testDbName'
			};
			mongo.getDb(dbConfig)
				.then(function() {
					expect(connectStub).to.have.been.calledOnce;
					expect(connectStub).to.be.calledWith('mongodb://testUser:testPass@testHost.com:12345,testHost2.com:67890/testDbName?replicaSet=rs0');
					done();
				})
				.catch(done);
		});

		it('should return a promise for the db if db connection succeeds', function(done) {
			var fakeDb = { 'fake': 'db' };
			//simulate valid connection, which would return a db object
			connectStub.withArgs(sinon.match('validDbName')).resolves(fakeDb);
			var result = mongo.getDb({ dbName: 'validDbName' });
			expect(result).to.eventually.deep.equal(fakeDb).and.notify(done);
		});

		it('should return a rejected promise if db connection fails', function(done) {
			//simulate failed connection
			connectStub.withArgs(sinon.match('badDbName')).rejects(new Error());
			var result = mongo.getDb({ dbName: 'badDbName' });
			expect(result).to.be.rejected.and.notify(done);
		});

		it('should return the same promise for a db connection if called more than once', function(done) {
			var fakeDb = { 'fake': 'db' };
			connectStub.withArgs(sinon.match('validDbName')).resolves(fakeDb);

			var dbConfig = { dbName: 'validDbName' };
			Promise.all([ mongo.getDb(dbConfig), mongo.getDb(dbConfig) ])
				.then(function(results) {
					expect(connectStub).to.have.been.calledOnce;
					expect(results[0]).to.equal(results[1]);
					done();
				})
				.catch(done);
		});

		it('should properly cache different db connections when called with different dbNames', function(done) {
			var firstDb = { 'first': 'db' };
			var secondDb = { 'second': 'db' };
			connectStub.withArgs(sinon.match('firstDbName')).resolves(firstDb);
			connectStub.withArgs(sinon.match('secondDbName')).resolves(secondDb);
			var dbConfig1 = { dbName: 'firstDbName' };
			var dbConfig2 = { dbName: 'secondDbName' };
			Promise.all([ mongo.getDb(dbConfig1), mongo.getDb(dbConfig1), mongo.getDb(dbConfig2), mongo.getDb(dbConfig2) ])
				.then(function(results) {
					expect(results[0]).to.equal(results[1]);
					expect(results[2]).to.equal(results[3]);
					expect(results[0]).not.to.equal(results[2]);
					done();
				})
				.catch(done);
		});

	});

	describe('.close()', function() {

		var closeStub;

		beforeEach(function() {
			closeStub = sinon.stub();
			connectStub.withArgs(sinon.match('test')).resolves({ close: closeStub });
			reRequireMongoWrapper();
			mongo.setConfig({});
		});

		afterEach(function() {
			closeStub.reset();
		});

		it('should call db.close()', function(done) {
			mongo.getDb('test')
				.then(function() {
					return mongo.close('test');
				})
				.then(function() {
					expect(closeStub).to.have.been.calledOnce;
					done();
				})
				.catch(done);
		});

		it('shouldn\'t throw an error if the db connection was never opened', function(done) {
			var promise = mongo.close('fakeDb');
			expect(promise).to.be.fulfilled.and.notify(done);
		});

		it('shouldn\'t re-call db.close() more than once if called again', function() {
			return mongo.getDb('test')
				.then(function() {
					return mongo.close('test');
				})
				.then(function() {
					return expect(closeStub).to.have.been.calledOnce;
				})
				.then(function() {
					return mongo.close('test');
				})
				.then(function() {
					return expect(closeStub).to.have.been.calledOnce;
				});
		});
	});
});

var reRequireMongoWrapper = function() {
	var fakeMongoClient = function(){};
	mongo = proxyquire('../src/mongoWrapper', {
		mongodb: {
			'@noCallThru': true,
			MongoClient: fakeMongoClient,
			Collection: function(){},
			ObjectID: function(){}
		}
	});
	fakeMongoClient.connectAsync = connectStub;
};
