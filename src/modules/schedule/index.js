/**
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Salakar
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

import {hostname} from 'os';
import {mergeDeep, randomInt} from './../../helpers';
import Schedule from './schedule';

const LOOP_DELAY = 700; // ms
const HOST_NAME = hostname();
const SCHEDULER_LOCK_EXPIRE = 10000; // default expire, set in case a node locks up, another can then pick it up in X ms
const UPDATE_SCHEDULE_DELAY = 450000; // once per 50 secs

export default class Scheduler {
  constructor(options, rdb) {
    this.rdb = rdb;
    this.id = rdb.id;
    this.options = {
      enabled: true
    };

    mergeDeep(this.options, options);

    this.rdb.log.verbose(`${this.constructor.name} module has been mounted!`);

    this._timer = null;
    this._running = false;
    this._stalled = false;
    this._completed = false;
    this._schedules = {}; // local cache of schedules - will update once every minute
    this._lastStartedAt = new Date();
    this._schedulerLockKey = this.rdb.toKey('scheduler:lock');
    this._schedulesLastUpdated = new Date();
    this._scheduleLockAcquired = false;
    this._preventStallingTimeout = null;
    this._preventGatherStallingTimeout = null;
    this.rdb.subscribe(this.rdb.toKey('scheduler:schedule:created'), ::this._newScheduleCreatedEvent);
    this.start();
  }

  /**
   *
   */
  start() {
    if (!this._running) {
      this._running = true;
      this._gatherSchedules(true)
          .then(::this._schedulerLoop)
          .catch(gatherError => this.rdb.log.error(gatherError));
    } else {
      this.rdb.log.warn(new Error('Cannot start scheduler as it\'s already started!'));
    }
  }

  /**
   * Stop the scheduler gracefully. Use 'force' param to force a stop.
   * @param force {Boolean} True to force stop.
   */
  stop(force) {
    this._running = false;
    if (force || this._completed) {
      clearTimeout(this._timer);
      clearTimeout(this._preventStallingTimeout);
    } else {
      setTimeout(this.stop, 250);
    }
  }

  _newScheduleCreatedEvent(event) {
    this._gatherSchedules(true)
        .then(function () {

        })
    console.dir(event);
  }

  /**
   *
   * @param error
   * @private
   */
  _schedulerLoopComplete(error) {
    if (!this._completed) {
      const timeTaken = new Date() - this._lastStartedAt;
      let delay = LOOP_DELAY - (timeTaken < 0 ? 0 : timeTaken);

      this._completed = true;
      // clear previous timers

      clearTimeout(this._preventStallingTimeout);
      clearTimeout(this._timer);

      // emit stalled event if the last loop didn't finish in time
      if (this._stalled) {
        this.rdb.log.warn({
          date: new Date(),
          client_status: this.rdb.client.status,
          schedules: this._schedules
        });
        this._stalled = false;
      }

      // if we acquired the lock the last time then set the
      // schedule lock to expire just before next iteration of scheduler
      // this is so the scheduler only runs 1 per DELAY across all server/cluster nodes
      if (this._scheduleLockAcquired) {
        const rand = Math.floor(Math.random() * 25) + 1;
        this.rdb.client.pexpire(this._schedulerLockKey, delay - rand);
      }

      // setup next scheduler loop
      if (this._running) {
        // if no schedules then lets not be spammy eh
        // will revert back to faster loops when we have schedules
        if (!this._schedules.length) {
          delay = 3000;
        }
        // if there was an error in the last loop lets delay it a little to prevent
        // spammy errors should redis connection die or various server issues
        if (error) {
          //this.emit('error', error);
          delay = delay + 1000;
        }
        // set next scheduler loop timeout
        this._timer = setTimeout(::this._schedulerLoop, delay);
      }
    }
  }

  /**
   *
   * @private
   */
  _schedulerLoop() {
    this._stalled = false;
    this._completed = false;
    this._scheduleLockAcquired = false;
    this._preventStallingTimeout = null;
    this._lastStartedAt = new Date();

    // stall prevention allows 500ms plus 25ms per schedule before classing as stalled.
    this._preventStallingTimeout = setTimeout(() => {
      this._stalled = true;
      process.nextTick(::this._schedulerLoopComplete);
    }, 500 + (Object.keys(this._schedules).length * 25));

    // try and get a run schedules lock
    this.rdb.client.psetnxex(this._schedulerLockKey,
      SCHEDULER_LOCK_EXPIRE,
      this._getHostLockInfo(true), (lockError, lockAcquired) => {
        if (lockError) {
          sails.log.error(lockError);
          return process.nextTick(::this._schedulerLoopComplete(lockError));
        }
        if (lockAcquired) {
          this.rdb.log.info(new Date().getTime(), 'Acquired scheduler lock, running schedule checks.');
          this._scheduleLockAcquired = true;
          this._processSchedules()
              .then(process.nextTick(::this._schedulerLoopComplete))
              .catch(process.nextTick(::this._schedulerLoopComplete));
        } else {
          this._scheduleLockAcquired = false;
          this.rdb.log.info('Scheduler LOCKED, skipping schedule checks.');
          return process.nextTick(::this._schedulerLoopComplete);
        }
      });
  }

  /**
   *
   * @param json
   * @returns
   */
  _getHostLockInfo(json) {
    const info = {
      locked_by: {
        id: this.rdb.id,
        pid: process.pid,
        title: process.title,
        host: HOST_NAME
      },
      timestamp: new Date().getTime()
    };
    if (json) return JSON.stringify(info);
    return info;
  }

  /**
   *
   * @returns {Promise}
   */
  _processSchedules() {
    return new Promise((resolve, reject) => {
      this._gatherSchedules(false).then(function (schedules) {
        if (!schedules || !schedules.length) {
          return resolve();
        }

        // TODO run schedules
        this.rdb.log.info(schedules);

        return resolve();

      }).catch(reject);

    });
  }

  /**
   * Retrieves all schedules from redis or local cache
   * Notes: If redis schedule retrieval takes longer than 2.5 secs then stall prevention will kick in
   * and just return cached schedules.
   * @param force
   * @returns {Promise}
   */
  _gatherSchedules(force:boolean) {
    let resolved = false;
    return new Promise((resolve) => {
      if (force || new Date() - this._schedulesLastUpdated >= UPDATE_SCHEDULE_DELAY) {
        const gatherComplete = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(this._preventGatherStallingTimeout);
            return resolve(this._schedules);
          }
        };

        this._preventGatherStallingTimeout = setTimeout(gatherComplete, 2000);

        this.rdb.client.hgetall(this.rdb.toKey(`scheduler:schedules`), (err, schedules) => {
          this._schedules = schedules;
          this._schedulesLastUpdated = new Date();
          if (!resolved) {
            gatherComplete();
          }
        });
      } else {
        return resolve(this._schedules);
      }
    });
  }

  /**
   *
   * @param name
   * @param options
   * @returns {Schedule}
   */
  create(name, options) {
    return new Schedule(this, name, options);
  }

}

