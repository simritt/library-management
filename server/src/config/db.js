const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.NODE_ENV === 'test' ? (process.env.TEST_DB_NAME || 'library_test_db') : (process.env.DB_NAME || 'library_db'),
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  dateStrings: true
};

const pool = mysql.createPool(dbConfig);

module.exports = {
  pool,
  dbConfig
};
