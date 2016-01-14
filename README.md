# RediBox

![Coverage](https://img.shields.io/coveralls/salakar/redibox.svg)
![Downloads](https://img.shields.io/npm/dm/redibox.svg)
![Downloads](https://img.shields.io/npm/dt/redibox.svg)
![npm version](https://img.shields.io/npm/v/redibox.svg)
![dependencies](https://img.shields.io/david/salakar/redibox.svg)
![dev dependencies](https://img.shields.io/david/dev/salakar/redibox.svg)
![License](https://img.shields.io/npm/l/redibox.svg)

Ultimate redis toolbox for node. Built using ES6/ES7 features and as lightweight as possible with just 2 dependencies.

## What can you do with RediBox?

RediBox offers out of the box support for many of the common Redis [use cases](#module-documentation). Not only that,
it also provides easy wrappers / utilities around redis client connection monitoring, scaling cluster reads with [`READONLY`](http://redis.io/commands/readonly)
and error handling.

**Currently available features:**
 - **[Caching](/src/modules/cache/README.md)**, including easy wrapper helpers, e.g `wrapPromise`, `wrapWaterlineQuery` (for sails), `wrapExpressRequest`
 - **Redis Clusters** with optional cluster scaled slave reads.
 - Custom **LUA Command** bootstrapping.

## Getting Started

Pre-alpha so not quite usable yet. Come back in a few days :)

Install it via npm:

```shell
npm install redibox
```

And include in your project:

```javascript
// ES6
import Redibox from 'redibox';
const RediBox = new Redibox({
  redis: {
    port: 7777
  }
}); // optional callback for bootstrap ready status or use events:

RediBox.on('ready' function(clientStatus) {
  rediBox.log.info(error); // internal redibox instance of winston if needed.
  // use cache module to set a cached value with a 60 second validity time.
  rediBox.cache.set('myKey', 'myVal', 60); // use a callback or a promise
});

RediBox.on('error' function(error) {
  rediBox.log.error(error); // internal redibox instance of winston if needed.
});
```


## RediBox Core

Provides the core set of utilities used by all modules and can also be used in your own code.

For example, you can easily get a connected client to run your own redis commands:

```javascript
// ...
// init your RediBox instance here and check boot ready
// state / events here (as demonstrated in the previous example)
// ...

// get a client and run any redis commands you want on it.
RediBox.getClient().hgetall(...); // callback or promise

// alternatively if you're using a redis cluster and have set `redis.clusterScaleReads` to true
// then you can also use this to get a client for read only purposes that will read from
// your cluster slaves.
const RedisReadOnlyClient = RediBox.getReadOnlyClient();

RedisReadOnlyClient.hget(....); // callback or promise

// This will error though as you cannot issue a `write` command to a read only instance.
RedisReadOnlyClient.hset(....); // callback or promise
```

#### RediBox.quit();
Force close all redis client connections without waiting for any pending replies.

#### RediBox.disconnect();
Close all redis client connections but wait for any pending replies first.

#### RediBox.getReadOnlyClient();
Returns a redis client for read only purposes. This is useful for cluster mode where `redis.clusterScaleReads` is set to `true`. This client is able to read from redis cluster slaves.

#### RediBox.getClient();
Returns a read/write redis client.

#### static RediBox.isClientConnected(client);
Returns the connection state of the redis client provided.

## Module Documentation

 - [Cache] (/src/modules/cache/README.md)



## Upcoming Features / TODO
 - **Distributed Locks** using the [Redlock](http://redis.io/topics/distlock) algorithm to `acquire`, `release` and `renew` locks.
 - **Throttling**, limit something to X times per Y time period with one easy call, for example: api requests.
 - **Time Series** want pretty stats and graphs? This will generate hits and allow easy querying of data with timestamp based range filtering.
 - Indexes - http://redis.io/topics/indexes wrappers to aid using redis as a secondary index or for things like autocompletion.


## Contributing

Full contributing guidelines are to be written, however please ensure you follow the points when sending in PRs:

- Ensure no lint warns occur via `npm run lint`.


## License

MIT
