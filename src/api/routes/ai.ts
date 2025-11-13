'use strict';
export default {
  routes: [
    {
      method: 'POST',
      path: '/ai/chat',
      handler: 'api::ai.ai.chat',
      config: {
        auth: false,
      },
    },
  ],
};
