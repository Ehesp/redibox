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

import os from 'os';
import util from 'util';
import Schedule from './schedule';
import { EventEmitter } from 'events';

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

let LOOP_DELAY = 0; // ms

const HOST_NAME = os.hostname();
const SCHEDULER_LOCK_EXPIRE = 10000; // default expire, set in case a node locks up, another can then pick it up in X ms
const UPDATE_SCHEDULE_DELAY = 60000;

class Scheduler {

  /**
   *
   * @param queue
   * @param options
   * @param luaCache
   */
  constructor(queue, options, luaCache) {
    LOOP_DELAY = randInt(250, 333);
    this.queue = queue;
    this.lua = luaCache;
    this.client = {};
    this.options = options || {};
    this.running = false;
    this.schedules = []; // local cache of schedules - will update once every minute
    this.schedulerLockKey = this.queue.toKey('scheduler:lock');
    this.schedulesLastUpdated = new Date();
    // scheduler loop variables
    this.stalled = false;
    this.completed = false;
    this.lastStartedAt = new Date();
    this.scheduleLockAcquired = false;
    this.preventStallingTimeout = null;
  }

  /**
   *
   */
  start() {
    if (!this.running) {
      this.running = true;
      // emit start event
      this.emit('started', this.getHostLockInfo());
      this.gatherSchedules(true)
          .then(this.schedulerLoop.bind(this))
          .catch((gatherError) => {
            this.emit('error', gatherError);
          });
    }
  }

  /**
   * Stop the scheduler gracefully. Use 'force' param to force a stop.
   * @param force {Boolean} True to force stop.
   */
  stop(force) {
    this.running = false;
    if (force || this.completed) {
      // scheduler has completed
      this.emit('stopped', this.getHostLockInfo());
      clearTimeout(this.timer);
      clearTimeout(this.preventStallingTimeout);
    } else {
      // last loop of scheduler still running, retry in a few secs
      setTimeout(this.stop, 250);
    }
  }

  /**
   *
   * @param error
   */
  schedulerLoopComplete(error) {
    if (!this.completed) {
      const timeTaken = new Date() - this.lastStartedAt;
      let delay = LOOP_DELAY - (timeTaken < 0 ? 0 : timeTaken);

      this.completed = true;
      // clear previous timers

      clearTimeout(this.preventStallingTimeout);
      clearTimeout(this.timer);

      // emit stalled event if the last loop didn't finish in time
      if (this.stalled) {
        this.emit('stalled', {
          date: new Date(),
          clientConnectionStatus: this.client.status,
          schedulesAtTimeOfStall: this.schedules
        });
      }

      // if we acquired the lock the last time then set the
      // schedule lock to expire just before next iteration of scheduler
      // this is so the scheduler only runs 1 per DELAY across all server/cluster nodes
      if (this.scheduleLockAcquired) {
        const rand = Math.floor(Math.random() * 25) + 1;
        this.client.pexpire(this.schedulerLockKey, delay - rand);
      }

      // setup next scheduler loop
      if (this.running) {
        // if no schedules then lets not be spammy eh
        // will revert back to faster loops when we have schedules
        if (!this.schedules.length) {
          delay = 3000;
        }
        // if there was an error in the last loop lets delay it a little to prevent
        // spammy errors should redis connection die or various server issues
        if (error) {
          this.emit('error', error);
          delay = delay + 500;
        }
        // set next scheduler loop timeout
        this.timer = setTimeout(this.schedulerLoop.bind(this), delay);
      }
    }
  }

  /**
   *
   */
  schedulerLoop() {
    this.stalled = false;
    this.completed = false;
    this.scheduleLockAcquired = false;
    this.preventStallingTimeout = null;
    this.lastStartedAt = new Date();

    // stall prevention allows 500ms plus 25ms per schedule before classing as stalled.
    this.preventStallingTimeout = setTimeout(() => {
      this.stalled = true;
      process.nextTick(this.schedulerLoopComplete.bind(this));
    }, 500 + (this.schedules.length * 25));

    // try and get a run schedules lock
    this.client.evalsha(this.lua.shaKeys.pSetNxEx, 1,
      this.schedulerLockKey,
      SCHEDULER_LOCK_EXPIRE,
      this.getHostLockInfo(true), (lockError, lockAcquired) => {
        if (lockError) {
          sails.log.error(lockError);
          return process.nextTick(::this.schedulerLoopComplete(lockError));
        }
        if (lockAcquired) {
         // console.log(new Date().getTime(), this.queue.name, 'Acquired scheduler lock, running schedule checks.');
          this.scheduleLockAcquired = true;
          this.processSchedules()
              .then(process.nextTick(::this.schedulerLoopComplete))
              .catch(process.nextTick(::this.schedulerLoopComplete));
        } else {
          //console.log('Scheduler LOCKED, skipping schedule checks.');
          return process.nextTick(::this.schedulerLoopComplete);
        }
      });
  }

  /**
   *
   * @param client
   */
  setClient(client) {
    this.client = client;
  }

  /**
   *
   * @param json
   * @returns
   */
  getHostLockInfo(json) {
    const info = {
      lockedBy: {
        pid: process.pid,
        title: process.title,
        host: HOST_NAME
      },
      queueName: this.queue.name,
      timestamp: new Date().getTime()
    };
    if (json) {
      return JSON.stringify(info);
    }
    return info;
  }

  /**
   *
   * @returns {Promise}
   */
  processSchedules() {
    return new Promise(async (resolve, reject) => {
      try { // async promise functions don't catch errors - lolwut
        let schedules = [];

        try {
          schedules = await this.gatherSchedules(false);
        } catch (gatherSchedulesError) {
          return reject(gatherSchedulesError);
        }

        if (!schedules || !schedules.length) {
          return resolve();
        }

        // TODO run schedules
        console.dir(schedules);

        return resolve();
      } catch (PromiseError) {
        return reject(PromiseError);
      }
    });
  }

  /**
   * Retrieves all schedules from redis or local cache
   * Notes: If redis schedule retrieval takes longer than 2.5 secs then stall prevention will kick in
   * and just return cached schedules.
   * @param force
   * @returns {Promise}
   */
  gatherSchedules(force:boolean) {
    let preventStallingTimeout;
    let resolved = false;
    return new Promise((resolve) => {
      if (force || new Date() - this.schedulesLastUpdated >= UPDATE_SCHEDULE_DELAY) {
        const gatherComplete = () => {
          resolved = true;
          clearTimeout(preventStallingTimeout);
          return resolve(this.schedules);
        };

        if (!resolved) {
          preventStallingTimeout = setTimeout(gatherComplete, 2000);
        }

        this.client.hgetall(this.queue.toKey(`schedules`), (err, schedules) => {
          this.schedules = schedules;
          this.schedulesLastUpdated = new Date();
          if (!resolved) {
            gatherComplete();
          }
        });
      } else {
        return resolve(this.schedules);
      }
    });
  }

  /**
   *
   * @param name
   * @param options
   * @returns {Schedule}
   */
  createSchedule(name, options) {
    return new Schedule(this, name, options);
  }

}

util.inherits(Scheduler, EventEmitter);
export default Scheduler;

