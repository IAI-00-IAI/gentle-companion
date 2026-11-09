// Injected into proxied HTML pages. __PREFIX__ and __PORT__ are replaced by the daemon.
// Sends runtime requests through the bridge: root-relative URLs (which would otherwise reach
// Companion itself), Request objects, and absolute URLs to the bridged server on any loopback name.
// WebSockets are not proxied and are left untouched.
(function () {
  var PREFIX = __PREFIX__;
  var PORT = String(__PORT__);
  var LOOPBACK_HOSTS = { 'localhost': true, '127.0.0.1': true, '[::1]': true, '0.0.0.0': true };
  var here = new URL(location.href);

  function rewrite(input) {
    var url;
    try {
      url = new URL(String(input), location.href);
    } catch (error) {
      return input;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return input;
    var sameOrigin = url.origin === here.origin;
    var bridgedServer = url.protocol === 'http:' && LOOPBACK_HOSTS[url.hostname] === true && (url.port || '80') === PORT;
    if (!sameOrigin && !bridgedServer) return input;
    var alreadyBridged = url.pathname === PREFIX || url.pathname.indexOf(PREFIX + '/') === 0;
    if (sameOrigin && alreadyBridged) return input;
    return PREFIX + url.pathname + url.search + url.hash;
  }

  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      if (typeof Request === 'function' && input instanceof Request) {
        var target = rewrite(input.url);
        if (target !== input.url) input = new Request(target, input);
      } else {
        input = rewrite(input);
      }
      return nativeFetch.call(this, input, init);
    };
  }

  var nativeOpen = window.XMLHttpRequest && XMLHttpRequest.prototype.open;
  if (nativeOpen) {
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      args[1] = rewrite(url);
      return nativeOpen.apply(this, args);
    };
  }

  function wrapConstructor(name) {
    var Native = window[name];
    if (typeof Native !== 'function') return;
    var Wrapped = function (url, options) {
      return new Native(rewrite(url), options);
    };
    Wrapped.prototype = Native.prototype;
    window[name] = Wrapped;
  }
  wrapConstructor('EventSource');
  wrapConstructor('Worker');
  wrapConstructor('SharedWorker');

  var nativeBeacon = navigator.sendBeacon;
  if (nativeBeacon) {
    navigator.sendBeacon = function (url, data) {
      return nativeBeacon.call(this, rewrite(url), data);
    };
  }
})();
