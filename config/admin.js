module.exports = {
  vite: {
    server: {
      hmr: {
        // Cấu hình này cho phép "hot reload" (chỉnh sửa nóng)
        // hoạt động qua một domain public
        host: 'ec2-18-189-20-60.us-east-2.compute.amazonaws.com',
        protocol: 'http',
      },
      // ĐÂY LÀ DÒNG QUAN TRỌNG TỪ THÔNG BÁO LỖI:
      allowedHosts: ['ec2-18-189-20-60.us-east-2.compute.amazonaws.com'],
    },
  },
};
