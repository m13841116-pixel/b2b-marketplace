const http = require('http');

const data = JSON.stringify({
  categoryId: 1,
  name: "تست محصول",
  shortDescription: "یک محصول تستی",
  longDescription: "توضیحات طولانی",
  supplierBasePrice: 10000,
  discount: 0,
  sku: "TEST-SKU",
  brand: "تست برند",
  stock: 10,
  images: [],
  mainImage: "",
  variants: []
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/supplier/products',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    // Need a valid token. Let's see if we can generate one.
  }
});
