from abc import ABC, abstractmethod

from app.sop_schema import SopPayload


class SopGenerator(ABC):
    @abstractmethod
    def generate(self, session) -> SopPayload:
        pass
