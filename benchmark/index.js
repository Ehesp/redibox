var Benchmark = require('benchmark');
var suite = new Benchmark.Suite();
var RediBox = require('./../lib').default;

/**
 * These benchmarks require a cluster running locally:
 * Just type the following commands using the redis create-cluster script
 * which can be found in the redis download archive under utils/create-cluster.
 *    1) create-cluster start
 *    2) create-cluster create
 */

var Cache = new RediBox({
  redis: {
    cluster: true,
    clusterScaleReads: true,
    connectionTimeout: 12000,
    hosts: [
      {
        host: '127.0.0.1',
        port: 30001
      },
      {
        host: '127.0.0.1',
        port: 30002
      },
      {
        host: '127.0.0.1',
        port: 30003
      },
      {
        host: '127.0.0.1',
        port: 30004
      },
      {
        host: '127.0.0.1',
        port: 30005
      },
      {
        host: '127.0.0.1',
        port: 30006
      }
    ]
  },
  log: {
    level: 'verbose'
  }
}, function (err) {
  if (err)
    throw err;
  // add tests
  suite.add('Cache Get', {

    // a flag to indicate the benchmark is deferred
    defer: true,

    // benchmark test function
    fn: function (deferred) {
      // call `Deferred#resolve` when the deferred test is finished
      Cache.get(Math.random()).then(() => {
        deferred.resolve()
      }).catch(function (err) {
        console.dir(err);
      });
    }
  });

  suite.add('Cache Set NX EX', {

    // a flag to indicate the benchmark is deferred
    defer: true,

    // benchmark test function
    fn: function (deferred) {
      // call `Deferred#resolve` when the deferred test is finished
      Cache.set(123456, 45678, () => {
        deferred.resolve();
      });
    }
  });

  // add listeners
  suite.on('cycle', function (event) {
    console.log(String(event.target));
  });

  suite.on('complete', function () {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
    process.exit();
  });

  // run async
  suite.run({async: false});
});

Cache.on('error', function (error) {
  console.log(error);
});
