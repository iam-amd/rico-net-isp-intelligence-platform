"""Network node Pydantic schemas — moved from routers/network_nodes.py."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class NetworkNodeCreate(BaseModel):
    node_name: str = Field(min_length=1, max_length=100)
    node_type: str = Field(default="pole", max_length=50)
    location_description: Optional[str] = Field(default=None, max_length=500)
    geo_lat: Optional[float] = None
    geo_long: Optional[float] = None
    parent_node_id: Optional[int] = None


class NetworkNodeUpdate(BaseModel):
    node_name: Optional[str] = Field(default=None, max_length=100)
    node_type: Optional[str] = Field(default=None, max_length=50)
    location_description: Optional[str] = Field(default=None, max_length=500)
    geo_lat: Optional[float] = None
    geo_long: Optional[float] = None
    status: Optional[str] = Field(default=None, max_length=20)
    parent_node_id: Optional[int] = None


class NodeOutageCreate(BaseModel):
    description: str = Field(min_length=1, max_length=1000)
    severity: str = Field(default="medium", max_length=20)
