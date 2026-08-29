"""Modular extensions for the Infinit Audit API.

The legacy API still lives in ``server.py`` while routes are progressively moved
into focused modules. ``main.py`` composes the new modules with the unchanged
legacy routes so feature work no longer makes the legacy module larger.
"""
