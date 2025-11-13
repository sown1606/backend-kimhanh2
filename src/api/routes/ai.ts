'use strict';
module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/ai/chat',
      handler: 'ai.chat',
      config: {
        // Cho phép user 'public' (chưa đăng nhập) được chat
        auth: false,
      },
    },
  ],
};
