"use client";

import simpleRestDataProvider from "@refinedev/simple-rest";

import { API_URL } from "@/config";
import { getAuthHeaders } from "@/lib/auth-utils";

export const dataProvider = {
  ...simpleRestDataProvider(API_URL),

  // OVERRIDE: This forces the slash '/' that fixed your error
  getList: async ({ resource }: any) => {
    // 1. Build the URL with the Slash
    const url = `${API_URL}/${resource}/`;

    // 2. Fetch Data
    const response = await fetch(url, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("Network Error");

    const data = await response.json();

    // 3. Return to Refine
    return {
      data: data,
      total: data.length,
    };
  },
};