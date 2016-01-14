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

RediBox offers out of the box support for many of the common Redis [use cases](#use-cases-and-modules). Not only that,
it also provides easy wrappers / utilities around redis client connection monitoring, scaling cluster reads with [`READONLY`](http://redis.io/commands/readonly)
and error handling.

**Currently available features:**
 - **[Caching](/src/modules/cache/README.md)**, including easy wrapper helpers, e.g `wrapPromise`, `wrapWaterlineQuery` (for sails), `wrapExpressRequest`
 - **Redis Clusters** with optional cluster scaled slave reads.
 - Custom **LUA Command** bootstrapping.

To see docs for each of the individual features see the [use cases](#use-cases-and-modules) section.

## Getting Started

Install via npm:

```shell
npm install redibox --save
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

## Use Cases and Modules

 - [Cache](/src/modules/cache/README.md)



## Upcoming Features / TODO
 - **Distributed Locks** using the [Redlock](http://redis.io/topics/distlock) algorithm to `acquire`, `release` and `renew` locks. (base module already setup)
 - **Throttling**, limit something to X times per Y time period with one easy call, for example: api requests. (base module already setup)
 - **Time Series** want pretty stats and graphs? This will generate hits and allow easy querying of data with timestamp based range filtering. (base module already setup)
 - **Indexes** - http://redis.io/topics/indexes wrappers to aid using redis as a secondary index. (base module already setup)
 - Allow userland to load in their own modules via the module loader.


## Contributing

Full contributing guidelines are to be written, however please ensure you follow these points when sending in PRs:

- Ensure no lint warns occur via `npm run lint`.
- Implement tests for new features / functionality.
- Use verbose logging throughout for ease of debugging issues, see core.js for example.
- New modules should follow the same format as the others, these get magically bootstrapped by the loader.

To add custom lua scripts to the modules simply create a `scripts.js` file (see the Cache module one for the layout) in the root of the module, the module loader will automatically define the commands on the clients, neat!

If you're creating a fresh module that's not in the todo list above, the simple copy one of the other modules and away you go, simples!

**Note:** For debugging purposes you may want to enable verbose logging via the config:

```javascript
  new RediBox({
    log: {
      level: 'verbose'
    }
  });
```

## License

MIT
