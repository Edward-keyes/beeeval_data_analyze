import httpx

_original_client_init = httpx.Client.__init__

def _patched_client_init(self, *args, **kwargs):
    kwargs["verify"] = False
    kwargs["http2"] = False
    kwargs["trust_env"] = False
    kwargs.pop("proxy", None)
    kwargs.pop("proxies", None)
    _original_client_init(self, *args, **kwargs)

httpx.Client.__init__ = _patched_client_init

_original_async_client_init = httpx.AsyncClient.__init__

def _patched_async_client_init(self, *args, **kwargs):
    kwargs["verify"] = False
    kwargs["http2"] = False
    kwargs["trust_env"] = False
    kwargs.pop("proxy", None)
    kwargs.pop("proxies", None)
    _original_async_client_init(self, *args, **kwargs)

httpx.AsyncClient.__init__ = _patched_async_client_init

print("HTTPX SSL/Connection patch applied.")
