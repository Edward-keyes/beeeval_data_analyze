import httpx
print(f"httpx version: {httpx.__version__}")
try:
    client = httpx.Client(proxy="http://test")
    print("proxy arg works")
except TypeError as e:
    print(f"proxy arg failed: {e}")

try:
    client = httpx.Client(proxies="http://test")
    print("proxies arg works")
except TypeError as e:
    print(f"proxies arg failed: {e}")
