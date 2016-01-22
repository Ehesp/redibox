import util from 'util';
import _Job from './job';
import {EventEmitter} from 'events';
import {noop, deepGet, mergeDeep} from './../../helpers';

class Queue {

  /**
   *
   * @param options
   * @param rdb
   * @returns {Queue}
   */
  constructor(options, rdb):Queue {
    this.rdb = rdb;
    this.name = options.name;
    this.paused = false;
    this.jobs = {};
    this.options = {
      stallInterval: 5000,
      prefix: 'rdb:job',
      isWorker: true,
      getEvents: false,
      sendEvents: true,
      enableScheduler: true,
      removeOnSuccess: true,
      catchExceptions: false
    };

    mergeDeep(this.options, options);

    if (this.options.getEvents) {
      // todo
      // this.rdb.subscriber.subscribe(this.toKey('events'));
      // this.rdb.subscriber.on('message', this.onMessage.bind(this));
    }

    if (this.options.enableScheduler && !process.argv.join('').includes('hive-no-scheduler')) {
      // todo
      // attach an instance of the scheduler
      // this.scheduler = new Scheduler(this.options.scheduler, this.rdb);
    }
    this.emit.bind(this, 'ready');
  }


  onMessage() {
    // TODO
    //message = JSON.parse(message);
    //if (message.event === 'failed' || message.event === 'retrying') {
    //  message.data = Error(message.data);
    //}
    //
    //this.emit('job ' + message.event, message.id, message.data);
    //
    //if (this.jobs[message.id]) {
    //  if (message.event === 'progress') {
    //    this.jobs[message.id].progress = message.data;
    //  } else if (message.event === 'retrying') {
    //    this.jobs[message.id].options.retries = this.jobs[message.id].options.retries - 1;
    //  }
    //
    //  this.jobs[message.id].emit(message.event, message.data);
    //
    //  if (message.event === 'succeeded' || message.event === 'failed') {
    //    delete this.jobs[message.id];
    //  }
    //}
  }

  /**
   *
   * @param cb
   */
  destroy(cb = noop) {
    const keys = ['id', 'jobs', 'stallTime', 'stalling', 'waiting', 'active', 'succeeded', 'failed']
      .map(key => this.toKey(key));
    this.rdb.client.del.apply(this.rdb.client, keys.concat(cb));
  }

  /**
   *
   * @returns {Promise}
   */
  checkHealth():Promise {
    return new Promise((resolve, reject) => {
      this.rdb.client.multi()
          .llen(this.toKey('waiting'))
          .llen(this.toKey('active'))
          .scard(this.toKey('succeeded'))
          .scard(this.toKey('failed'))
          .exec(function (err, results) {
            if (err) return reject(err);
            return resolve({
              waiting: results[0][1],
              active: results[1][1],
              succeeded: results[2][1],
              failed: results[3][1]
            });
          });
    });
  }

  /**
   *
   * @param data
   * @returns {Job}
   */
  createJob(data):Job {
    return new _Job(this, null, data);
  }

  createSchedule(name, options) {
    return this.scheduler.createSchedule(name, options);
  }

  /**
   *
   * @param jobId
   * @returns {Promise}
   */
  getJob(jobId:string):Promise {
    return new Promise((resolve, reject) => {
      // check if we have the job locally in memory
      if (jobId in this.jobs) {
        return process.nextTick(resolve.bind(null, this.jobs[jobId]));
      }
      // else gather from redis
      Job.fromId(this, jobId)
         .then(job => {
           this.jobs[jobId] = job;
           return resolve(job);
         }).catch(reject);
    });
  }

  /**
   *
   * @returns {Promise}
   */
  getNextJob():Promise {
    return new Promise((resolve, reject)=> {
      this.rdb.client.brpoplpush(
        this.toKey('waiting'),
        this.toKey('active'), 0, (err, jobId) => {
          if (err) return reject(err);
          return _Job.fromId(this, jobId).then(resolve).catch(reject);
        });
    });
  }

  /**
   *
   * @param job
   * @returns {Promise}
   */
  runJob(job:_Job):Promise {
    return new Promise((resolve, reject) => {
      const handler = (typeof this.handler === 'string' ?
          deepGet(global, this.handler) : this.handler) || deepGet(global, job.data.runs);

      let preventStallingTimeout;
      let handled = false;

      const handleOK = data => {
        // silently ignore any multiple calls
        if (handled) {
          return;
        }

        handled = true;

        // set the data back to internal data
        job.data = job._internalData;

        clearTimeout(preventStallingTimeout);
        this.finishJob(null, data, job).then(resolve).catch(reject);
      };

      const handleError = err => {
        clearTimeout(preventStallingTimeout);
        // silently ignore any multiple calls
        if (handled) {
          return;
        }

        handled = true;

        // set the data back to internal data
        if (job._internalData) {
          job.data = job._internalData;
        }

        this.rdb.log.error('');
        this.rdb.log.error('--------------- RDB JOB ERROR/FAILURE ---------------');
        this.rdb.log.error('Job: ' + job.data.runs || this.name);
        if (err.stack) {
          const errors = err.stack.split('\n');
          errors.forEach(error => {
            this.rdb.log.error(error);
          });
        }
        console.trace(err);
        this.rdb.log.error('------------------------------------------------------');
        this.rdb.log.error('');

        this.finishJob(err, null, job).then(resolve).catch(reject);
      };

      const preventStalling = () => {
        this.rdb.client.srem(this.toKey('stalling'), job.id, () => {
          if (!handled) {
            preventStallingTimeout = setTimeout(preventStalling, this.options.stallInterval / 2);
          }
        });
      };

      if (!handler) {
        return handleError(
          new Error(
            `"${job.data.runs || 'No Job Handler Specified'}" was not found. Skipping job. To fix this
         you must either specify a handler function via queue.process() or provide a valid handler
         node global path in your job options 'handler', e.g. if you had a global function in
         'global.sails.services.myservice' you'd specify the handler as 'sails.services.myservice.myHandler'.`
          )
        );
      }

      preventStalling(); // start stalling monitor

      job._internalData = job.data;
      job.data = job.data.data || job.data;

      if (job.options.timeout) {
        const msg = `Job ${job.id} timed out (${job.options.timeout}ms)`;
        setTimeout(handleError.bind(null, Error(msg)), job.options.timeout);
      }

      if (job.options.noBind || this.options.noBind) {
        handler(job).then(handleOK).catch(handleError);
      } else {
        job::handler(job).then(handleOK).catch(handleError);
      }
    });
  }

  /**
   *
   * @param err
   * @param data
   * @param job
   * @returns {Promise}
   */
  finishJob(err, data, job:_Job):Promise {
    return new Promise((resolve, reject) => {
      const status = err ? 'failed' : 'succeeded';
      const multi = this.rdb.client.multi()
                        .lrem(this.toKey('active'), 0, job.id)
                        .srem(this.toKey('stalling'), job.id);
      const jobEvent = {
        id: job.id,
        event: status,
        data: err ? err.message : data
      };

      if (status === 'failed') {
        if (job.options.retries > 0) {
          job.options.retries = job.options.retries - 1;
          job.status = 'retrying';
          jobEvent.event = 'retrying';
          multi.hset(this.toKey('jobs'), job.id, job.toData())
               .lpush(this.toKey('waiting'), job.id);
        } else {
          job.status = 'failed';
          multi.hset(this.toKey('jobs'), job.id, job.toData())
               .sadd(this.toKey('failed'), job.id);
        }
      } else {
        job.status = 'succeeded';
        multi.hset(this.toKey('jobs'), job.id, job.toData());
        if (this.options.removeOnSuccess) {
          multi.hdel(this.toKey('jobs'), job.id);
        } else {
          multi.sadd(this.toKey('succeeded'), job.id);
        }
      }

      if (this.options.sendEvents) {
        multi.publish(this.toKey('events'), JSON.stringify(jobEvent));
      }

      multi.exec(function (errMulti) {
        if (errMulti) {
          return reject(errMulti);
        }
        return resolve({status: status, result: err ? err : data});
      });
    });
  }

  /**
   *
   * @param concurrency
   * @param handler
   */
  process(concurrency, handler) {
    if (!this.options.isWorker) {
      return this.rdb.log.warn('Cannot start processing ( queue.process(); ) on a non-worker client.');
    }

    if (typeof concurrency === 'function' || typeof concurrency === 'string') {
      handler = concurrency;
      concurrency = 1;
    }

    this.handler = handler;
    this.running = 0;
    this.queued = 1;
    this.concurrency = concurrency;

    const jobTick = () => {
      if (this.paused) {
        this.queued = this.queued - 1;
        return;
      }

      // invariant: in this code path, this.running < this.concurrency, always
      // after spoolup, this.running + this.queued === this.concurrency
      this.getNextJob().then(job => {
        this.running = this.running + 1;
        this.queued = this.queued - 1;

        if (this.running + this.queued < this.concurrency) {
          this.queued = this.queued + 1;
          setImmediate(jobTick);
        }

        this.runJob(job).then(result => {
          this.running = this.running - 1;
          this.queued = this.queued + 1;
          this.emit(result.status, job, result.result);
          setImmediate(jobTick);
        }).catch(error => {
          this.running = this.running - 1;
          this.queued = this.queued + 1;
          this.emit('error', error);
          setImmediate(jobTick);
        });
      }).catch(error => {
        this.emit('error', error);
        return setImmediate(jobTick);
      });
    };

    // TODO move to job core module
    // const restartProcessing = () => {
    //   this.rdb.client.once('ready', jobTick);
    // };
    // this.rdb.client.once('error', restartProcessing);
    // this.rdb.client.once('close', restartProcessing);

    this.checkStalledJobs(setImmediate.bind(null, jobTick));
  }

  /**
   *
   * @param interval
   * @param cb
   */
  checkStalledJobs(interval, cb) {
    cb = typeof interval === 'function' ? interval : cb || noop;
    this.rdb.client.checkstalledjobs(this.toKey('stallTime'), this.toKey('stalling'), this.toKey('waiting'), this.toKey('active'),
      Date.now(), this.options.stallInterval, (err) => {
        /* istanbul ignore if */
        if (err) return cb(err);

        if (typeof interval === 'number') {
          setTimeout(this.checkStalledJobs.bind(this, interval, cb), interval);
        }

        return cb();
      }
    );
  }

  /**
   *
   * @param str
   * @returns {*}
   */
  toKey(str:string):string {
    if (this.rdb.isCluster()) {
      return `${this.options.prefix}:{${this.name}}:${str}`;
    }
    return `${this.options.prefix}:${this.name}:${str}`;
  }
}

util.inherits(Queue, EventEmitter);
export default Queue;
