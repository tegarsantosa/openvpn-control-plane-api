const app = require('./app');
const config = require('./config');

app.listen(config.port, "0.0.0.0",() => {
  console.log(`OpenVPN Control Plane API running on port ${config.port}`);
  if (process.env.NODE_ENV === "development") {
    console.log(`JWT_SECRET: ${config.jwt.secret}`);
    console.log(`JWT_EXPIRATION: ${config.jwt.expiration}`);
    console.log(`Keep these tokens secure`);
  }
  console.log(`API Documentation: :${config.port}/docs`);
});