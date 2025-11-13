module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // DÒNG QUAN TRỌNG NHẤT:
  // Thêm URL public của Strapi vào đây
  url: 'http://ec2-18-189-20-60.us-east-2.compute.amazonaws.com:1337',
  app: {
    keys: env.array('APP_KEYS'),
  },
});
