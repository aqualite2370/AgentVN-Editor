"""Application-specific errors."""


class AgentVNError(Exception):
    """Base application error."""


class AIProviderError(AgentVNError):
    """Raised when structured AI generation fails."""


class MemoryError(AgentVNError):
    """Raised when memory operations fail."""
