const http = require('http');

// JWT Secret from earlier
const jwt = require('jsonwebtoken');
const token = jwt.sign({ userId: 2, role: 'SUPPLIER' }, 'marketplace-super-jwt-secret-key-2026');

const data = JSON.stringify({
  categoryId: "1",
  name: 'تست 2',
  supplierBasePrice: 5000,
  stock: 10
});
const req2 = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/supplier/products',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
    'Content-Length': Buffer.byteLength(data)
  }
}, res2 => {
  let body2 = '';
  res2.on('data', d => body2 += d);
  res2.on('end', () => console.log('POST PRODUCT:', res2.statusCode, body2));
});
req2.write(data);
req2.end();
