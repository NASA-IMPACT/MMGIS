/***********************************************************
 * JavaScript syntax format: ES5/ES6 - ECMAScript 2015
 * Loading all required dependencies, libraries and packages
 **********************************************************/
const promise = require('bluebird');

let options = {
  //   Initialization Options
    promiseLib: promise
  };

const pgp = require('pg-promise')(options);
const { getDbPassword } = require('./Backend/Utils/dbPassword');

const cn = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER ,
  password: getDbPassword
};
const db = pgp(cn);

module.exports = {
    pgp, db
};