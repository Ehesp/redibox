const Rbox = require('./../lib').default;
//const mergeDeep = require('./../lib/helpers').mergeDeep;
//const Benchmark = require('benchmark');

// TODO
// TODO
// TODO      THIS BENCHMARK FILE IS MORE OF A TESTING
// TODO         PLAYGROUND AT THE MOMENT SRYNOTSRY
// TODO

/**
 * To benchmark with a local cluster,
 * Just type the following commands using the redis create-cluster script
 * which can be found in the redis download archive under utils/create-cluster.
 *    1) create-cluster start
 *    2) create-cluster create
 *
 */

// create new instance of RediBox
const RediBox = new Rbox({
  redis: {
    cluster: true,
    clusterScaleReads: false,
    subscriber: true, // enables pubsub subscriber client
    publisher: true,  // enables pubsub publisher client
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
  job: {
    prefix: 'job',
    enabled: true,
    queues: [
      {name: 'test', concurrency: 25}
    ]
  },
  cache: {
    enabled: true,
    prefix: 'rab:cache',
    defaultTTL: 600
  },
  log: {
    level: 'verbose'
  }
});

RediBox.on('error', function (error) {
  RediBox.log.error(error);
});

RediBox.on('ready', function (status) {
  RediBox.log.info(`Client status is: ${status.client}`);

  // Test job runner
  global.test = function () {
    console.dir(this.data); // bound by default but also the first arg sent to this func
    return new Promise(function (resolve, reject) {
      console.log('My test job Ran');
      return resolve();
      // if rejected the job with mark as failure and retry the job if `retries` is set.
    });
  };

  // create a test job
  RediBox.job.create('test', {
    // the global function name that can handle this job,
    // can even be dot notated e.g. test.obj.something.runner
    // running via globals is optional, the other way is to
    // pass a `handler` function to the individual quw
    runs: 'test',

    // some data to send along
    data: {
      foo: 'bar'
    }
  }).retries(3).save();
  // optionally to force unique jobs (based on data sha1sum) use .unique(true); an error
  // will be sent to the save callback if not unique


  // TESTING PUBSUB:

  // on message received listener
  const myListener = function (message) {
    console.dir(message.data); // HELLO but not GOODBYE
  };

  RediBox.subscribe('getMeSomeDataMrWorkerServer', myListener, function (err) {
    if (!err) {
      RediBox.publish('getMeSomeDataMrWorkerServer', 'HELLO');
      // some time later on:
      setTimeout(function () {
        RediBox.unsubscribe('getMeSomeDataMrWorkerServer', myListener);
        RediBox.publish('getMeSomeDataMrWorkerServer', 'GOODBYE');
      }, 2000);
    }
  });


  RediBox.subscribeOnce([
    'requestID-123456:request:dataPart1',
    'requestID-123456:request:dataPart2',
    'requestID-123456:request:dataPart3'
  ], function (message) { // on message received
    if (message.timeout) {
      return console.error(new Error(`Sub once to channel ${message.channel} timed out! =( `));
    }
    console.log('I received a message \\o/:');
    console.dir(message.channel); // channel name
    console.dir(message.timestamp); // when the message wa received
    console.dir(message.data); // JSON parsed data
  }, function (err) { // subscribed callback
    if (!err) {
      console.log('Subscribed once to multiple channels!');

      // test publish to just one channel, the rest will timeout
      // this is normally sent from somewhere else
      RediBox.publish('requestID-123456:request:dataPart1', {
        someArray: [1, 2, 3, 4, 5],
        somethingElse: 'foobar'
      });
    }
  }, 3000); // I want an event back within 3 seconds for each channel ( so each has 3 secs to respond )


  //if (status.client_read) {
  //  RediBox.log.info(`Read Only: Client status is: ${status.client}`);
  //}
  //
  ////suite.add('IPC Message ID generate', function () {
  ////  RediBox.ipc.generateMessageId();
  ////});
  //
  //RediBox.log.info(`Adding Benchmark 'RediBox Cache Get'`);
  //suite.add('RediBox Cache Get', {
  //  defer: true,
  //  fn: function (deferred) {
  //    RediBox.cache.get(123456).then(() => {
  //      deferred.resolve();
  //    }).catch(function (err) {
  //      deferred.resolve(err);
  //      RediBox.log.error(err);
  //    });
  //  }
  //});
  //
  //RediBox.log.info(`Adding Benchmark 'RediBox Cache Set'`);
  //suite.add('RediBox Cache Set', {
  //  defer: true,
  //  fn: function (deferred) {
  //    RediBox.cache.set(123456, 45678, () => {
  //      deferred.resolve();
  //    });
  //  }
  //});
  //
  //// add listeners
  //suite.on('cycle', function (event) {
  //  RediBox.log.info(String(event.target));
  //});
  //
  //suite.on('complete', function () {
  //  RediBox.log.info('\nFastest is ' + this.filter('fastest').map('name'));
  //  process.exit();
  //});
  //
  //RediBox.log.info(`Starting Benchmarks: \n`);
  //suite.run({async: true});
});
