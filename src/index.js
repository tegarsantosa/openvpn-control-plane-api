const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`OpenVPN Control Plane API running on port ${config.port}`);
  console.log(`JWT_SECRET: ${config.jwt.secret}`);
  console.log(`JWT_EXPIRATION: ${config.jwt.expiration}`);
  console.log(`Keep these tokens secure`);
  console.log(`API Documentation: http://localhost:${config.port}/docs`);
});