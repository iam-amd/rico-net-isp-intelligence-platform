"use client";

import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/nextjs-router";
import React from "react";
import { authProvider } from "@/providers/auth-provider/auth";

import { API_URL } from "@/config";

// Helper to get stored auth token for admin panel
function getAuthHeaders(): Record<string, string> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('admin_token') : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

const customDataProvider = {
  getList: async ({ resource, pagination, filters }: { resource: string, pagination?: { current?: number, pageSize?: number, currentPage?: number }, filters?: any[] }) => {
    // 1. Pagination Calculation
    const current = pagination?.current || pagination?.currentPage || 1;
    const pageSize = pagination?.pageSize || 10;
    const skip = (current - 1) * pageSize;

    // 2. Build URL with Query Params
    const url = new URL(`${API_URL}/${resource}/`);
    url.searchParams.append("skip", skip.toString());
    url.searchParams.append("limit", pageSize.toString());

    // 3. Handle Filtering
    if (filters) {
      filters.forEach((filter) => {
        if (filter.field === "q" && filter.operator === "eq") {
          url.searchParams.append("q", filter.value || "");
        }
        if (filter.field === "status" && filter.operator === "eq") {
          url.searchParams.append("status", filter.value);
        }
        if (filter.field === "expiry_filter" && filter.operator === "eq") {
          url.searchParams.append("expiry_filter", filter.value);
        }
        if (filter.field === "expiry_start" && filter.operator === "eq") {
          url.searchParams.append("expiry_start", filter.value);
        }
        if (filter.field === "expiry_end" && filter.operator === "eq") {
          url.searchParams.append("expiry_end", filter.value);
        }
      });
    }

    try {
      const response = await fetch(url.toString(), {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error("Failed to fetch data");
      }
      const json = await response.json();

      // 4. Systematic Response Handling
      const items = json.items || [];
      const total = json.total || 0;

      return {
        data: items,
        total: total,
      };
    } catch (error) {
      throw error;
    }
  },
  getOne: async ({ resource, id }: { resource: string, id: any }) => {
    const response = await fetch(`${API_URL}/${resource}/${id}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("Failed to fetch record");
    const data = await response.json();
    return { data };
  },
  create: async ({ resource, variables }: { resource: string, variables: any }) => {
    const response = await fetch(`${API_URL}/${resource}/`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(variables),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to create record");
    }
    const data = await response.json();
    return { data };
  },
  update: async ({ resource, id, variables }: { resource: string, id: any, variables: any }) => {
    const response = await fetch(`${API_URL}/${resource}/${id}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(variables),
    });
    if (!response.ok) throw new Error("Failed to update record");
    const data = await response.json();
    return { data };
  },
  deleteOne: async ({ resource, id }: { resource: string, id: any }) => {
    const response = await fetch(`${API_URL}/${resource}/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("Failed to delete record");
    return { data: {} };
  },
  getApiUrl: () => API_URL,
  custom: async ({ url, method, filters, sort, payload, query, headers }: { url: string, method: string, filters?: any[], sort?: any[], payload?: any, query?: any, headers?: any }) => {
    let requestUrl = new URL(url);

    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        requestUrl.searchParams.append(key, String(value));
      });
    }

    try {
      const response = await fetch(requestUrl.toString(), {
        method: method,
        headers: {
          ...getAuthHeaders(),
          ...headers,
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });

      if (!response.ok) {
        throw new Error("Custom request failed");
      }
      const data = await response.json();

      return { data };
    } catch (error) {
      throw error;
    }
  },
};

export const RefineContext = ({ children }: { children: React.ReactNode }) => {
  return (
    <Refine
      routerProvider={routerProvider}
      dataProvider={customDataProvider as any}
      authProvider={authProvider}
      resources={[
        {
          name: "customers",
          list: "/customers",
          create: "/customers/create",
          edit: "/customers/edit/:id",
          show: "/customers/show/:id",
        },
        {
          name: "tickets",
          list: "/tickets",
          create: "/tickets/create",
          edit: "/tickets/edit/:id",
        },
        {
          name: "technicians",
          list: "/technicians",
          show: "/technicians/show/:id",
          edit: "/technicians/edit/:id",
        }
      ]}
    >
      {children}
    </Refine>
  );
};