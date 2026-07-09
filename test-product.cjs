const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ where: { role: 'SUPPLIER' } });
  console.log("Suppliers:", users.length);
  if (users.length === 0) return;
  const supplierId = users[0].id;

  const products = await prisma.product.findMany({ where: { supplierId } });
  console.log("Products:", products.length);
}
main().finally(() => prisma.$disconnect());
