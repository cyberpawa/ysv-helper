class DomainError(Exception):
    """Base application exception mapped cleanly to HTTP responses."""


class HighDemandError(DomainError):
    """Raised when the primary LLM endpoint reports temporary overload (503)."""


class QuotaExceededError(DomainError):
    """Raised when API rate limits or quotas are exceeded (429)."""


class NotATimesheetError(DomainError):
    """Raised when the uploaded image does not contain a recognizable timesheet table."""


class ResourceNotFoundError(DomainError):
    """Raised when the requested domain record does not exist."""


class AccessDeniedError(DomainError):
    """Raised when a user tries to access or modify another user's resource."""
