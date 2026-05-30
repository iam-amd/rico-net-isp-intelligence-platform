"""
Ticket API tests — CRUD operations and authorization checks.
Tests run against the real database.
"""
import pytest


class TestListTickets:
    """GET /tickets/"""

    def test_list_tickets(self, client, admin_token, auth_headers):
        """Admin should be able to list tickets (returns 200 with a list)."""
        response = client.get(
            "/tickets/",
            params={"status": "Open"},
            headers=auth_headers(admin_token),
        )
        assert response.status_code == 200
        data = response.json()
        # The response uses TicketListResponse which wraps items in a list
        assert "items" in data or isinstance(data, list)

    def test_unauthorized_access(self, client):
        """Accessing /tickets/ without a token should return 401."""
        response = client.get("/tickets/")
        assert response.status_code == 401


class TestTicketStats:
    """GET /tickets/stats"""

    def test_get_ticket_stats(self, client, admin_token, auth_headers):
        """Admin should be able to fetch ticket statistics."""
        response = client.get(
            "/tickets/stats",
            headers=auth_headers(admin_token),
        )
        assert response.status_code == 200


class TestCreateTicket:
    """POST /tickets/"""

    def test_create_ticket(self, client, admin_token, auth_headers, db):
        """Admin should be able to create a ticket for an existing customer."""
        # Find an existing customer to use
        from models import Customer
        customer = db.query(Customer).first()
        if customer is None:
            pytest.skip("No customers in the database to test ticket creation")

        payload = {
            "issue_type": "Test Issue",
            "description": "Automated test ticket — safe to delete",
            "priority": "Low",
            "customer_id": customer.username,
        }
        response = client.post(
            "/tickets/",
            json=payload,
            headers=auth_headers(admin_token),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["issue_type"] == "Test Issue"
        assert data["customer_id"] == customer.username

        # Cleanup: delete the ticket we just created
        ticket_id = data["id"]
        delete_resp = client.delete(
            f"/tickets/{ticket_id}",
            headers=auth_headers(admin_token),
        )
        assert delete_resp.status_code == 200
