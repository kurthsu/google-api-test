const 
  _ = require('lodash'),
  GoogleAuth = require('./googleAuth'),
  {google} = require('googleapis'),
  fs = require('fs'),
  appData = require('./appData.json'),
  async = require('async');

GoogleAuth.authorize((auth) => {
  main(auth);
});

function main(auth) {
  let name = 'POS 考題';

  const drive = google.drive({version: 'v3', auth});
  let savedModifiedTime = _.isUndefined(appData.lastModifiedTime) ? 0 : new Date(appData.lastModifiedTime).getTime();

  async.auto({
    search_files: (cb) => {
      searchFileByName(drive, name, (files) => {
        if (_.isEmpty(files)) {
          console.log(`search file with '${name}' not found`);
          cb('not_found');
          return;
        }

        let lastModifiedTime = new Date(files[0].modifiedTime).getTime();
        if (lastModifiedTime <= savedModifiedTime) {
          console.log(`file '${name}' does not been modified recently`);
          cb(null, null);
          return;
        }

        // only handling the first matched file
        appData.lastModifiedTime = files[0].modifiedTime;
        fs.writeFile('./appData.json', JSON.stringify(appData), (err) => {
          if (err) {
            console.warn('write to appData.jsosn error', err);
          }
        });
        cb(null, files[0])
      });
    },
    export_csv_file: ['search_files', (results, cb) => {
      if (results.search_files === null) {
        cb(null);
        return;
      }
      exportCSVFile(drive, results.search_files.id, (err) => {
        if (err) {
          console.error('exportCSVFile getting error', err);
          cb('export_error');
          return;
        }
        console.log('fetching file to csv completed');
        cb(null);
      });
    }],
    parse_csv_file: ['export_csv_file', (results, cb) => {
      parseCSVFile((orders) => cb(null, orders));
    }],
    analyze_data: ['parse_csv_file', (results, cb) => {
      analyzeCSVData(results.parse_csv_file);
      console.log('analyzing data completed');
      cb();
    }]
  }, (err, results) => {
    if (err) {
      console.err(`analyzing data error due to ${err}`);
    }
  });
}

function searchFileByName(drive, name, callback) {
  drive.files.list({
    q: `name = '${name}' and mimeType='application/vnd.google-apps.spreadsheet'`,
    fields: 'files(id, modifiedTime)',
    spaces: 'drive',
  }, (err, response) => {
    let files = [];
    callback(response.data.files);
  });
}

function exportCSVFile(drive, fileId, callback) {
  let dest = fs.createWriteStream(`./tmp.csv`);
  drive.files.export({
    fileId: fileId,
    mimeType: 'text/csv'
  }, {
    responseType: 'stream'
  }, (err, response) => {
    if (err)
      return callback(err);
    response.data
      .on('error', err => callback(err))
      .on('end', () => callback(null))
      .pipe(dest);
  });
}

function parseCSVFile(callback) {
  const csv = require('fast-csv');
  let headers = null;
  let orders = [];
  fs.createReadStream('tmp.csv')
    .pipe(csv())
    .on('data', (data) => {
      if (_.isNull(headers)) {
        if (checkHeaders(data)) {
          headers = data;
        }
      }
      else {
        if (checkOrder(data)) {
          orders.push(data);
        }
      }
    })
    .on('end', (data) => {
      callback(convertToObjecs(headers, orders));
    });
}

function analyzeCSVData(orders) {
  let dateArray = Array(7).fill().map((value, i) => `1/${i+1}`);
  console.log('\t\t目標點擊\t1/1\t1/2\t1/3\t1/4\t1/5\t1/6\t1/7');
  orders.forEach((order) => {
    let targetClicks = _.parseInt(order.targetClicks.replace(/,/g,''));
    let resultString = `${order.id}\t${targetClicks}\t`
    for (i in dateArray) {
      let dailyClicks = _.parseInt(order[dateArray[i]].replace(/,/g,''));
      resultString += `\t${targetClicks-dailyClicks}`;
    }
    console.log(resultString);
  });
}

/**
* helpers for analyzing csv data
*/
function checkHeaders(data) {
  if (!_.isArray(data)) return false;

  if (findIndex(data, '訂單編號') >= 0)
    return true;
  return false;
}

function checkOrder(data) {
  if (!_.isArray(data)) return false;

  var re = /[0-9]{8}/;
  if (re.test(data[0])) {
    return true;
  }
  return false;
}

function findIndex(data, value) {
  return _.findIndex(data, (item) => item === value);
}

function convertToObjecs(headers, orders) {
  let keyMaps = {
    '訂單編號': 'id',
    '目標點擊': 'targetClicks'
  };
  let objs = [];
  orders.forEach((order) => {
    obj = {};
    for (i in headers) {
      let key = keyMaps[headers[i]] || headers[i];
      obj[key] = order[i];
    }
    objs.push(obj);
  });
  return objs;
}