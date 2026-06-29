const API_STATUS_CODE = {
  // ==============================================
  // Successful responses
  // ==============================================

  /**
   * 200 OK
   *
   * The request succeeded. The result meaning of "success" depends on the HTTP method:
   *
   * 1. `GET`: The resource has been fetched and transmitted in the message body.
   * 2. `HEAD`: The representation headers are included in the response without any message body.
   * 3. `PUT` or `POST`: The resource describing the result of the action is transmitted in the message body.
   * 4. `TRACE`: The message body contains the request message as received by the server.
   */
  OK: 200,

  /**
   * 201 Created
   *
   * The request succeeded, and a new resource was created as a result. This is typically the response sent
   * after POST requests, or some PUT requests.
   */
  CREATED: 201,

  /**
   * 202 Accepted
   *
   * The request has been received but not yet acted upon. It is noncommittal, since there is no way in HTTP
   * to later send an asynchronous response indicating the outcome of the request. It is intended for cases
   * where another process or server handles the request, or for batch processing.
   */
  ACCEPTED: 202,

  // ==============================================
  // Client error responses
  // ==============================================

  /**
   * 400 Bad Request
   *
   * The server cannot or will not process the request due to something that is perceived to be a client error
   * (e.g., malformed request syntax, invalid request message framing, or deceptive request routing).
   */
  BAD_REQUEST: 400,

  /**
   * 401 Unauthorized
   *
   * Although the HTTP standard specifies "unauthorized", semantically this response means "unauthenticated".
   * That is, the client must authenticate itself to get the requested response.
   */
  UNAUTHORIZED: 401,

  /**
   * 403 Forbidden
   *
   * The client does not have access rights to the content; that is, it is unauthorized, so the server is
   * refusing to give the requested resource. Unlike 401 Unauthorized, the client's identity is known to the server.
   */
  FORBIDDEN: 403,

  /**
   * 402 Payment Required
   *
   * Reserved for future use; we use it to signal that the tenant's current
   * subscription plan does not include the requested capability (upgrade needed).
   */
  PAYMENT_REQUIRED: 402,

  /**
   * 404 Not Found
   *
   * The server can not find the requested resource. In the browser, this means the URL is not recognized. In an API,
   * this can also mean that the endpoint is valid but the resource itself does not exist. Servers may also send this
   * response instead of 403 Forbidden to hide the existence of a resource from an unauthorized client. This response
   * code is probably the most well known due to its frequent occurrence on the web.
   */
  NOT_FOUND: 404,

  /**
   * 409 Conflict
   *
   * This response is sent when a request conflicts with the current state of the server.
   */
  CONFLICT: 409,

  /**
   * 406 Not Acceptable
   *
   * This response is sent when the server doesn’t find any content that conforms to the criteria given by
   * the user agent in the Accept header sent in the request.
   */
  NOT_ACCEPTABLE: 406,

  /**
   * 429 Too Many Requests
   *
   * The user has sent too many requests in a given amount of time ("rate limiting").
   */
  TOO_MANY_REQUESTS: 429,

  // ==============================================
  // Server error responses
  // ==============================================

  /**
   * 500 Internal Server Error
   *
   * The server has encountered a situation it does not know how to handle.
   */
  INTERNAL_SERVER_ERROR: 500,
};

module.exports = Object.freeze({
  API_STATUS_CODE,
});
