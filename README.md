# Overview
----

This is a wrapper around the native [node mongodb driver](https://github.com/mongodb/node-mongodb-native).
It wraps the native module, adding some commonly-needed functionality out of the box, such as:  

- building a connection string
- initializing the database connection
- closing the database connection
- wrapping query function calls on Collection objects in [bluebird](https://github.com/petkaantonov/bluebird)-style promises
- wrapping returned cursors in promises as well
- adding query caching functionality to the `aggregate` and `mapReduce` functions

# Setup
----

- Clone the repo
- run ```npm install```
- run ```npm test``` to run all tests for this module

# Usage
----

To setup your configuration options for defining how to connect to mongo:

```javascript
var porqpine = require('porqpine');
porqpine.setConfig(myDbConfigObject); //see API Documentation for info on what this parameter needs to be
```

To get a reference to a `db` connection:

```javascript
porqpine.getDb('someDbName') //shown here is the dbName-only syntax sugar for getDb() params. See documentation.
	.then(function(db) {
		return db.collection('myCollection').findOneAsync( ... );
	});
```

Best practice would be to not store your own copy of any `db` object. When you need to use a `db` object—even one you've used before—you should always call `getDb(dbName)`:

```javascript
porqpine.getDb('someDbName')
	.then(function(db) {
		return db.collection('myCollection').updateAsync( ... );
	})
	.catch(function(err) { ... });

... 

porqpine.getDb('someDbName')
	.then(function(db) {
		return db.collection('otherCollection').findOneAsync( ... );
	})
	.catch(function(err) { ... });
```
Don't open and close multiple connections yourself—the mongodb.MongoClient will handle connection pooling for you.
However, don't forget to close your connection when your application is exiting:

```javascript
porqpine.close('someDbName')
	.then(function() {
		console.info('Database connection closed');
		myApplication.safeExit();
	})
	.catch(function(err) { ... });
```

or you can close all open connections:
```javascript
porqpine.closeAll()
	.then(function() {
		console.info('All database connections closed');
		myApplication.safeExit();
	})
	.catch(function(err) { ... });
```

The `db` object obtained from `getDb(name)` will provide all of the standard functions that the mongodb module provides.
Its `collection` method will also return an instance of a mongodb [Collection](http://mongodb.github.io/node-mongodb-native/api-generated/collection.html#collection)
object that has augmented with bluebird's [promisifyAll](https://github.com/petkaantonov/bluebird/blob/master/API.md#promisification) function.
You can use this as follows:

```javascript
porqpine.getDb()
	.then(function(db) {
		return db.collection('lamps').insertAsync(myNewLampObject)
			.then(function(results) {
				//do something with results
			});
	})
	.catch(function(err) { ... });
```
# API
----

#### `.setConfig(dbConfig)`
> sets up the mongodb connection parameters.  

**_@params_**:

- **dbConfig** \- object with the following keys
	- **hosts**: \- array of objects, with each object taking the form:  
	  { host: 'somehost.com', port: 1234 }
	- **user**: _(optional)_ \- string containing the username to use for authentication
	- **pass**: _(optional)_ \- string containing the password to use for authentication (ignored if `user` is not specified)
	- **replicaSet**: _(optional)_ \- string containing the name of the replicaset to connect to.  


----
#### `.close(dbName)`
> Closes your mongo connection to the given database;
  
**_@returns_**: a promise that will be resolved once the connection is finished closing.
**_@params_**: 

- **dbName** \- the name of the database for which to close the connection

----
#### `.closeAll()`
> Closes all your open mongo connections;
  
**_@returns_**: a promise that will be resolved once the connections are all finished closing.
**_@params_**: none

  
----
#### `.getDb(dbNameOrConfigObject)`
> Returns a connection to the given database. If no connection has already been established, one will be created.
  
**_@returns_**: a promise that will be resolved with a connected database object.
**_@params_**:

- **dbNameOrConfigObject** \- either a string containing the name of the database to connect to, or an entire dbConfig object to use for 
connecting. see `setConfig` param documentation. This config object should contain a `dbName` key containing the database name
  
----
#### `.objectId(id)`
> Creates a BSON ObjectID given a raw id.

**_@returns_**: an object instance of a BSON ObjectID (see [ObjectID documentation](http://mongodb.github.io/node-mongodb-native/api-bson-generated/objectid.html#objectid) for details).
**_@params_**:  

- **id** \- a 24-byte hex string, a 12-byte binary string, or a Number

  
----
#### `.objectIds(ids)`
> A shortcut for creating multiple ObjectIDs given an array.

**_@returns_**: an array of object instances of a BSON ObjectID (see [ObjectID documentation](http://mongodb.github.io/node-mongodb-native/api-bson-generated/objectid.html#objectid) for details).
**_@params_**:  

- **ids** \- an array of 24-byte hex strings, a 12-byte binary strings, or Numbers  
  


# `Collections` object
----

Bluebird's `promisifyAll` is called on the Collection object's prototype. This makes it so you can use query functions in the style of promises. For example, instead of passing a callback:

```javascript
db.collection('myCollection').findOne({ ... }, function(err, res) {
	...
});
```

you can do it with promises:

```javascript
db.collection('myCollection').findOneAsync({ ... })
	.then(function(res) {
		...
	})
	.catch(function(err) {
		...
	});
```

Since some Collection functions (such as `find`) return a cursor this library accounts for that, too, by calling `promisifyAll` on the resulting cursor.
This lets you do things like this:

```javascript
db.collection('myCollection')
	.find(queryCriteria)
	.sort(sortCriteria)
	.skip(5)
	.limit(100)
	.toArrayAsync()			// <-- this promisifies the result
	.then(function(res) {
		...
	})
	.catch(function(err) {
		...
	});
```


# Semi-transparent Query Caching
----

In addition to all the standard query functions on the Collection prototype, porqpine adds a few additional functions:

- `cachedAggregate`
- `cachedMapReduce`

These are intended as a way of allowing for mostly-transparent caching of expensive queries.
When these functions are used, they will first attempt to lookup a cached result. If it is found, the cached result will be returned.
If no cached result is found, then the original query is run, and that result is then stored in the cache.

Here is the detailed documentation on these cached functions:

#### `.cachedAggregate(cacheOptions, pipeline[, options], callback)`
> Performs a mongo aggregate query, but attempts to find a cached result for the query before running it,
then if not, runs the query and stores the result in the cache afterward

**_@params_**:

- **cacheOptions** \- either a string containing the cache collection name, or an object with the following keys:
	- **cacheCollectionName**: \- the name of the collection to use for the cache.
	- **forceUpdateCache**: _(optional)_ \- if true, ignores any cached results and re-runs the query
- **pipeline** \- the pipeline for the aggregate function. same as the native driver
- **options**: \- _(optional)_ \- options for the query. same as the native driver
- **callback**: \- the function to call upon completion

\* Note that the use of the `cursor: true` option is not supported with the cachedAggregate function

----
#### `.cachedMapReduce(cacheOptions, map, reduce[, options], callback)`
> Performs a mongo mapReduce query, but attempts to find a cached result for the query before running it,
then if not, runs the query and stores the resulting collectionName in the cache afterward

**_@params_**:

- **cacheOptions** \- either a string containing the cache collection name, or an object with the following keys:
	- **cacheCollectionName**: \- the name of the collection to use for the cache.
	- **forceUpdateCache**: _(optional)_ \- if true, ignores any cached results and re-runs the query
- **map** \- the map function for the mapReduce. same as the native driver
- **reduce** \- the reduce function for the mapReduce. same as the native driver
- **options**: \- _(optional)_ \- options for the query. same as the native driver
- **callback**: \- the function to call upon completion

\* Note that if the option to return the result inline is specified, it will work as expected. Otherwise—
since the mapReduce function returns a resulting collection by default—the cache will store the name of
the resulting collection. When called, this function will return a reference to the Collection object with
that name.

----
Of course, these functions are also promisified, so they can be used in the promise style, as well:

```javascript
db.collection('myCollection').cachedAggregateAsync('cacheCollectionName', pipelineArgs)
	.then(function(res) {
		// res will contain the result of the aggregation (or a previously cached result)
	})
	.catch(function(err) {
		...
	});
```

**DISCLAMER:** as with any caching solution, you will need to pay particular attention to cache validity when using these functions. Porqupine makes no effort to ensure data consistency or provide any kind of cache invalidation strategy, so you'll have to implement one yourself if you choose to use these helpers. Needless to say, if you have frequently-changing data, you will want to think long and hard about the implications of cached queries before using these functions.





