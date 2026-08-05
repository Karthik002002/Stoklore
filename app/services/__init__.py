"""Logic shared by more than one router - and by the chat agent's tools.

The rule that keeps this layer honest: a service never imports a router. Anything two routers
both need lives here instead of one router reaching into the other.
"""
