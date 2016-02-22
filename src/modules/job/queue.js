import util from 'util';
import _Job from './job';
import {EventEmitter} from 'events';
import Promise from 'bluebird';
import {noop, deepGet, mergeDeep, isObject} from './../../helpers';

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
    this.handler = options.handler || null;
    this.started = false;
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

    this.rdb.createClient('bclient', false, () => {
      this.rdb.log.verbose(`Block client for queue '${this.name}' is ready. Starting queue processor.`);
      this.process(this.options.concurrency);
    }, this);

    // if (this.options.enableScheduler) {
    // // todo
    // // attach an instance of the scheduler
    // this.scheduler = new Scheduler(this.options.scheduler, this.rdb);
    // }
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
  createJob(data):_Job {
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
      _Job.fromId(this, jobId)
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
  _getNextJob():Promise {
    this.rdb.log.verbose(`Getting next job for queue '${this.name}'.`);
    return new Promise((resolve, reject)=> {
      this.bclient.brpoplpush(
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
  _runJob(job:_Job):Promise {
    return new Promise((resolve, reject) => {
      const runs = job.data && job.data.runs && Array.isArray(job.data.runs) ? job.data.runs[0] : job.data.runs;
      const handler = (typeof this.handler === 'string' ?
          deepGet(global, this.handler) : this.handler) || deepGet(global, runs);

      let preventStallingTimeout;
      let handled = false;

      const handleOK = data => {

        // silently ignore any multiple calls
        if (handled) {
          return;
        }

        clearTimeout(preventStallingTimeout);

        handled = true;

        // set the data back to internal data
        if (job._internalData) {
          job.data = job._internalData;
        }

        if (job.data.runs && Array.isArray(job.data.runs)) {
          this._finishMultiJob(null, data, job).then(resolve).catch(reject);
        } else {
          this._finishSingleJob(null, data, job).then(resolve).catch(reject);
        }
      };

      const handleError = err => {
        clearTimeout(preventStallingTimeout);
        // silently ignore any multiple calls
        if (handled) {
          return;
        }

        handled = true;

        // set the data back to internal job data
        if (job._internalData) {
          job.data = job._internalData;
        }

        // only log the error if no notifyFailure pubsub set
        if ((!job.data.initialJob || !job.data.initialJob.options.notifyFailure) && !Array.isArray(job.data.runs)) {
          this.rdb.log.error('');
          this.rdb.log.error('--------------- RDB JOB ERROR/FAILURE ---------------');
          this.rdb.log.error('Job: ' + job.data.runs || this.name);
          if (err.stack) {
            err.stack.split('\n').forEach(error => {
              this.rdb.log.error(error);
            });
          }
          this.rdb.log.error(err);
          this.rdb.log.error('------------------------------------------------------');
          this.rdb.log.error('');
        }

        if (job.data.runs && Array.isArray(job.data.runs)) {
          this._finishMultiJob(err, null, job).then(resolve).catch(reject);
        } else {
          this._finishSingleJob(err, null, job).then(resolve).catch(reject);
        }
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
   * Completes a multi job or continues to the next stage.
   * @param error
   * @param data
   * @param job
   * @returns {Promise}
   * @private
	 */
  _finishMultiJob(error, data, job:_Job):Promise {
    return new Promise((resolve, reject) => {
      const status = error ? 'failed' : 'succeeded';

      const multi = this.rdb.client.multi()
                        .lrem(this.toKey('active'), 0, job.id)
                        .srem(this.toKey('stalling'), job.id);

      const event = {
        job: {
          id: job.id,
          worker_id: this.rdb.id,
          status,
          ...job.data
        },
        error: error,
        output: data
      };

      const currentJob = job.data.runs.shift();
      const nextJob = job.data.runs[0];
      let nextQueue = this.name;

      // keep a record of the first job in this relay instance
      // ssssh JSON ;p
      if (!job.data.initialJob) {
        job.data.initialJob = JSON.parse(job.toData());
      }

      // keep a record of the first queue in this relay instance
      if (!job.data.initialQueue) {
        job.data.initialQueue = this.name;
      }

      if (status === 'failed') {
        if (job.options.retries > 0) {
          job.options.retries = job.options.retries - 1;
          job.status = 'retrying';
          event.event = 'retrying';
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

      // check if we need to relay to another job
      if (!(job.data.runs.length === 0 || !!error)) {
        if (isObject(nextJob)) {
          nextQueue = nextJob.queue;
          job.data.runs[0] = nextJob.runs;
        } else if (job.data.initialQueue) {
          nextQueue = job.data.initialQueue;
        }

        // add some debug data for the next job
        // so it can tell where its call originated from
        job.data.from_job = currentJob;
        job.data.from_queue = this.name;
        job.data.from_timestamp = Math.floor(Date.now() / 1000);

        job.data.data = data;

        this.rdb.job.create(nextQueue, job.data).save(function () {
          multi.exec(function (errMulti) {
            if (errMulti) {
              return reject(errMulti);
            }
            return resolve({status: status, result: error ? error : data});
          });
        });
      } else { // we've just finished the last job in the relay
        if (event.error) {
          if (job.data.initialJob.options.notifyFailure) {
            this.rdb.publish(job.data.initialJob.options.notifyFailure, event);
          }
        } else if (job.data.initialJob.options.notifySuccess) {
          this.rdb.publish(job.data.initialJob.options.notifySuccess, event);
        }

        multi.exec(function (errMulti) {
          if (errMulti) {
            return reject(errMulti);
          }
          return resolve({status: status, result: error ? error : data});
        });
      }
    });
  }

  /**
   *
   * @param error
   * @param data
   * @param job
   * @returns {Promise}
   */
  _finishSingleJob(error, data, job:_Job):Promise {
    return new Promise((resolve, reject) => {
      const status = error ? 'failed' : 'succeeded';

      const multi = this.rdb.client.multi()
                        .lrem(this.toKey('active'), 0, job.id)
                        .srem(this.toKey('stalling'), job.id);

      const event = {
        job: {
          id: job.id,
          worker_id: this.rdb.id,
          status,
          ...job.data
        },
        error: error,
        output: data
      };

      if (status === 'failed') {
        if (job.options.retries > 0) {
          job.options.retries = job.options.retries - 1;
          job.status = 'retrying';
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

      if (event.error) {
        if (job.options.notifyFailure) this.rdb.publish(job.options.notifyFailure, event);
      } else if (job.options.notifySuccess) {
        this.rdb.publish(job.options.notifySuccess, event);
      }

      multi.exec(function (errMulti) {
        if (errMulti) {
          return reject(errMulti);
        }
        return resolve({status: status, result: error ? error : data});
      });
    });
  }

  /**
   * Start the queue.
   * @param concurrency
   */
  process(concurrency = 1) {
    if (!this.options.isWorker) {
      return this.rdb.log.warn('Cannot start processing ( queue.process(); ) on a non-worker client.');
    }

    if (this.started) {
      return this.rdb.log.warn(`Cannot start the queue processor for '${this.name}' - it's already running!`);
    }

    this.started = true;
    this.running = 0;
    this.queued = 0;
    this.concurrency = concurrency;
    this.rdb.log.verbose(`Queue '${this.name}' - started with a concurrency of ${this.concurrency}.`);

    const jobTick = () => {
      this.queued++;
      if (this.paused) {
        this.queued--;
        return;
      }

      this._getNextJob().then(job => {
        this.running++;

        if ((this.running + this.queued) < this.concurrency) {
          setImmediate(jobTick);
        }

        this._runJob(job).then(() => {
          this.running--;
          this.queued--;
          setImmediate(jobTick);
        }).catch(() => {
          this.running--;
          this.queued--;
          setImmediate(jobTick);
        });
      }).catch(error => {
        this.rdb.log.error(error);
        setImmediate(jobTick);
      });
    };

    const restartProcessing = () => {
      this.bclient.once('ready', jobTick);
    };

    this.bclient.once('error', restartProcessing);
    this.bclient.once('close', restartProcessing);

    this.checkStalledJobs(setImmediate.bind(null, jobTick));
  }

  /**
   *
   * @param interval
   * @param cb
   */
  checkStalledJobs(interval, cb) {
    cb = typeof interval === 'function' ? interval : cb || noop;
    this.rdb.client.checkstalledjobs(
      this.toKey('stallTime'),
      this.toKey('stalling'),
      this.toKey('waiting'),
      this.toKey('active'),
      Date.now(),
      this.options.stallInterval, (err) => {
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
