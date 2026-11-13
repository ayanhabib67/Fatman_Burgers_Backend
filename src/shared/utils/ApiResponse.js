class ApiResponse {
  static success(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  static created(res, data = null, message = 'Created') {
    return this.success(res, data, message, 201);
  }

  static error(res, message = 'Something went wrong', statusCode = 500, details = null) {
    return res.status(statusCode).json({
      success: false,
      message,
      ...(details ? { details } : {}),
    });
  }
}

module.exports = ApiResponse;
