from abc import ABC, abstractmethod

from app.models import Session
from app.sop_schema import SopPayload


class SopGenerator(ABC):
    @abstractmethod
    def generate(self, session: Session) -> SopPayload:
        pass
