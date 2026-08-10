const Sequelize = require("sequelize");
const logger = require("./logger");
const fs = require("fs");
require("dotenv").config();
// Required after dotenv so MODE resolves from the loaded .env. Reads the same
// single capability definition every other gate uses.
const { enabled } = require("./Backend/Utils/capabilities");

// create a sequelize instance with our local postgres database information.
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || "5432",
    dialect: "postgres",
    dialectOptions: {
      ssl:
        process.env.DB_SSL === "true"
          ? {
              require: true,
              rejectUnauthorized: true,
              ca:
                process.env.DB_SSL_CERT_BASE64 != null &&
                process.env.DB_SSL_CERT_BASE64 !== ""
                  ? Buffer.from(
                      process.env.DB_SSL_CERT_BASE64,
                      "base64"
                    ).toString("utf-8")
                  : process.env.DB_SSL_CERT != null &&
                    process.env.DB_SSL_CERT !== ""
                  ? fs.readFileSync(process.env.DB_SSL_CERT)
                  : false,
            }
          : false,
    },
    logging: process.env.VERBOSE_LOGGING == "true" || false,
    pool: {
      max:
        process.env.DB_POOL_MAX != null
          ? parseInt(process.env.DB_POOL_MAX) || 10
          : 10,
      min: 0,
      acquire:
        process.env.DB_POOL_TIMEOUT != null
          ? parseInt(process.env.DB_POOL_TIMEOUT) || 30000
          : 30000,
      idle:
        process.env.DB_POOL_IDLE != null
          ? parseInt(process.env.DB_POOL_IDLE) || 10000
          : 10000,
    },
  }
);

// create a sequelize instance with our local postgres database information.
// Gated on localSidecars (the STAC catalog is part of the sidecar cluster) AND
// the explicit WITH_STAC flag — mirrors the "capability AND raw flag" shape in
// Config/setup.js and init-db.js. In lean the catalog is never built even if a
// stray WITH_STAC=true leaks in.
const sequelizeSTAC =
  enabled("localSidecars") && process.env.WITH_STAC === "true"
    ? new Sequelize("mmgis-stac", process.env.DB_USER, process.env.DB_PASS, {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || "5432",
        dialect: "postgres",
        dialectOptions: {
          ssl:
            process.env.DB_SSL === "true"
              ? {
                  require: true,
                  rejectUnauthorized: true,
                  ca:
                    process.env.DB_SSL_CERT_BASE64 != null &&
                    process.env.DB_SSL_CERT_BASE64 !== ""
                      ? Buffer.from(
                          process.env.DB_SSL_CERT_BASE64,
                          "base64"
                        ).toString("utf-8")
                      : process.env.DB_SSL_CERT != null &&
                        process.env.DB_SSL_CERT !== ""
                      ? fs.readFileSync(process.env.DB_SSL_CERT)
                      : false,
                }
              : false,
        },
        logging: process.env.VERBOSE_LOGGING == "true" || false,
        pool: {
          max:
            process.env.DB_POOL_MAX != null
              ? parseInt(process.env.DB_POOL_MAX) || 10
              : 10,
          min: 0,
          acquire:
            process.env.DB_POOL_TIMEOUT != null
              ? parseInt(process.env.DB_POOL_TIMEOUT) || 30000
              : 30000,
          idle:
            process.env.DB_POOL_IDLE != null
              ? parseInt(process.env.DB_POOL_IDLE) || 10000
              : 10000,
        },
      })
    : null;

// Source: http://docs.sequelizejs.com/manual/installation/getting-started.html
sequelize
  .authenticate()
  .then(() => {
    logger(
      "info",
      "Database connection has successfully been established.",
      "connection"
    );
  })
  .catch((err) => {
    logger(
      "infrastructure_error",
      "Unable to connect to the database.",
      "connection",
      null,
      err
    );
  });

module.exports = { sequelize, sequelizeSTAC };
