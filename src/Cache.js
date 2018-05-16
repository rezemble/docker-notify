const fs      = require('fs');
const fsp     = fs.promises;
const path    = require('path');
const process = require('process');

let cachePath = path.join(process.cwd(), ..."/cache/cache.json".split('/'));

const Cache = (function(){
    let DATA = {};

    // scoped function to flush cache to disk
    const dump = ()=>{
        console.log('[CACHE] dumping data...');
        fs.writeFileSync(cachePath, JSON.stringify(DATA));
    };

    // pseudo class for scope clearance
    class Cache {
        setCache( data ) { // set entire cache
            return DATA = data;
        }
        getCache() { // get cache
            return DATA;
        }
        flush() { // manually flush as promise
            return fsp.writeFile(cachePath, JSON.stringify(DATA));
        }
    }

    // check if file exists
    fsp.access(cachePath, fs.constants.R_OK | fs.constants.W_OK)
        .then(d=>fsp.readFile(cachePath, 'utf8')) // if so, read
        .then(d=>JSON.parse(d)) // and parse from JSON
        .then(d=>DATA=d) // and set current cache
        .catch(e=>console.info('no cache file or cache file corrupt...', e));

    // dump data when process terminates
    process.on('exit', dump);

    // automatically dump every 60 seconds
    setInterval(dump, 60 * 1000);

    return new Cache();
})();

module.exports = Cache;
