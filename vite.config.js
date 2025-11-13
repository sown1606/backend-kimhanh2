import { defineConfig, mergeConfig } from 'vite';

export default (config) => {
  return mergeConfig(config, defineConfig({
    server: {
      // ĐÂY LÀ DÒNG QUAN TRỌNG TỪ THÔNG BÁO LỖI
      allowedHosts: [
        'ec2-18-189-20-60.us-east-2.compute.amazonaws.com'
      ]
    }
  }));
};
