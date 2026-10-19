import logging
import socket
from typing import Any

logger = logging.getLogger("dns_patch")

_orig_getaddrinfo = socket.getaddrinfo
_FALLBACK_DNS_SERVERS = ["8.8.8.8", "1.1.1.1"]

def _resilient_getaddrinfo(host: Any, port: Any, family: int = 0, type: int = 0, proto: int = 0, flags: int = 0):
    try:
        return _orig_getaddrinfo(host, port, family, type, proto, flags)
    except socket.gaierror as e:
        if isinstance(host, str) and not host.replace(".", "").isdigit():
            try:
                import dns.resolver
                resolver = dns.resolver.Resolver()
                resolver.nameservers = _FALLBACK_DNS_SERVERS
                resolver.timeout = 2.5
                resolver.lifetime = 4.0
                
                answers = resolver.resolve(host, "A")
                if answers:
                    resolved_ip = str(answers[0])
                    logger.info(f"[DNS Resiliente] Resuelto '{host}' via DNS publico fallback ({resolved_ip}) tras fallo de DNS local")
                    return _orig_getaddrinfo(resolved_ip, port, family, type, proto, flags)
            except Exception as res_err:
                logger.debug(f"[DNS Resiliente] Fallo resolver via DNS publico para {host}: {res_err}")
        raise e

def apply_dns_patch():
    """Patches socket.getaddrinfo to fallback to public DNS if local corporate DNS fails"""
    if socket.getaddrinfo is not _resilient_getaddrinfo:
        socket.getaddrinfo = _resilient_getaddrinfo
        logger.info("Parche DNS Resiliente activo (fallback a 8.8.8.8 / 1.1.1.1)")
