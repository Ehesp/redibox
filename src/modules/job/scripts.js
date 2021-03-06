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

export default {

  addJob: {
    keys: 3,
    lua: `
        --[[
        key 1 -> rab:job:name:jobs
        key 2 -> rab:job:name:waiting
        key 3 -> rab:job:name:id (job ID counter)
        arg 1 -> job data
        arg 2 -> should be unique?
        arg 3 -> customId
        ]]

        local jobId = ARGV[3]

        if jobId == "" then
          jobId = redis.call("incr", KEYS[3])
        end

        -- if unique enabled
        if ARGV[2] == "true" then
          local exists = redis.call("hsetnx", KEYS[1], jobId, ARGV[1])
          if exists == 1 then
            redis.call("lpush", KEYS[2], jobId)
            return jobId
          end
          return 0
        else
          -- if not unique enabled
          redis.call("hset", KEYS[1], jobId, ARGV[1])
          redis.call("lpush", KEYS[2], jobId)
          return jobId
        end
    `
  },

  checkStalledJobs: {
    keys: 4,
    lua: `
        --[[
        key 1 -> rab:job:name:stallTime
        key 2 -> rab:job:name:stalling
        key 3 -> rab:job:name:waiting
        key 4 -> rab:job:name:active
        arg 1 -> ms timestamp ("now")
        arg 2 -> ms stallInterval

        returns {resetJobId1, resetJobId2, ...}

        workers are responsible for removing their jobId from the stalling set every stallInterval ms
        if a jobId is not removed from the stalling set within a stallInterval window,
        we assume the job has stalled and should be reset (moved from active back to waiting)
        --]]

        local now = tonumber(ARGV[1])
        local stallTime = tonumber(redis.call("get", KEYS[1]) or 0)

        if now < stallTime then
          -- hasn't been long enough (stallInterval) since last check
          return 0
        end

        -- reset any stalling jobs by moving from active to waiting
        local stalling = redis.call("smembers", KEYS[2])
        if #stalling > 0 then
          redis.call("rpush", KEYS[3], unpack(stalling))
          for i = 1, #stalling do
            redis.call("lrem", KEYS[4], 0, stalling[i])
          end
          redis.call("del", KEYS[2])
        end

        -- copy currently active jobs into stalling set
        local actives = redis.call("lrange", KEYS[4], 0, -1)
        if #actives > 0 then
          redis.call("sadd", KEYS[2], unpack(actives))
        end

        redis.call("set", KEYS[1], now + ARGV[2])

        return stalling
    `
  },

  removeJob: {
    keys: 6,
    lua: `
        --[[
        key 1 -> rab:job:test:succeeded
        key 2 -> rab:job:test:failed
        key 3 -> rab:job:test:waiting
        key 4 -> rab:job:test:active
        key 5 -> rab:job:test:stalling
        key 6 -> rab:job:test:jobs
        arg 1 -> jobId
        ]]

        local jobId = ARGV[1]

        if (redis.call("sismember", KEYS[1], jobId) + redis.call("sismember", KEYS[2], jobId)) == 0 then
          redis.call("lrem", KEYS[3], 0, jobId)
          redis.call("lrem", KEYS[4], 0, jobId)
        end

        redis.call("srem", KEYS[1], jobId)
        redis.call("srem", KEYS[2], jobId)
        redis.call("srem", KEYS[5], jobId)
        redis.call("hdel", KEYS[6], jobId)
    `
  }
};
