// Injected into proxied HTML pages. __PREFIX__ and __PORT__ are replaced by the daemon.
// Sends runtime requests through the bridge: root-relative URLs (which would otherwise reach
// Companion itself), Request objects, and absolute URLs to the bridged server on any loopback name.
// WebSockets are not proxied and are left untouched. Workers are not supported: the sandboxed
// frame has an opaque origin, so browsers refuse to start a worker from a bridge URL.
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

  // Scripts that assign `iframe.src = '/page'` or call `setAttribute('src', '/page')` after load
  // would otherwise leave the bridge and load Companion's own app, which refuses to be framed.
  var URL_PROPERTIES = [
    ['HTMLIFrameElement', 'src'],
    ['HTMLScriptElement', 'src'],
    ['HTMLImageElement', 'src'],
    ['HTMLSourceElement', 'src'],
    ['HTMLMediaElement', 'src'],
    ['HTMLLinkElement', 'href'],
    ['HTMLAnchorElement', 'href'],
    ['HTMLFormElement', 'action']
  ];
  var URL_ATTRIBUTES = { src: true, href: true, action: true, formaction: true, poster: true };

  function wrapUrlProperty(constructorName, property) {
    var Native = window[constructorName];
    if (typeof Native !== 'function') return;
    var descriptor = Object.getOwnPropertyDescriptor(Native.prototype, property);
    if (!descriptor || !descriptor.set) return;
    Object.defineProperty(Native.prototype, property, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: function (value) {
        descriptor.set.call(this, rewrite(value));
      }
    });
  }
  URL_PROPERTIES.forEach(function (entry) {
    wrapUrlProperty(entry[0], entry[1]);
  });

  var NativeElement = window.Element;
  if (typeof NativeElement === 'function' && NativeElement.prototype.setAttribute) {
    var nativeSetAttribute = NativeElement.prototype.setAttribute;
    NativeElement.prototype.setAttribute = function (name, value) {
      if (URL_ATTRIBUTES[String(name).toLowerCase()] === true) value = rewrite(value);
      return nativeSetAttribute.call(this, name, value);
    };
  }

  var nativeWindowOpen = window.open;
  if (typeof nativeWindowOpen === 'function') {
    window.open = function (url) {
      var args = Array.prototype.slice.call(arguments);
      if (url !== undefined && url !== null) args[0] = rewrite(url);
      return nativeWindowOpen.apply(this, args);
    };
  }

  var nativeBeacon = navigator.sendBeacon;
  if (nativeBeacon) {
    navigator.sendBeacon = function (url, data) {
      return nativeBeacon.call(this, rewrite(url), data);
    };
  }
})();
