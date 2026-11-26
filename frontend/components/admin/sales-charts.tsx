"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPrice } from "@/lib/format";

export interface SalesData {
  daily: Array<{ day: string; revenue: number; orders: number }>;
  revenueByCategory: Array<{ category: string; revenue: number }>;
}

const rupees = (v: number) => `₹${Math.round(v / 100000)}k`;

export default function SalesCharts({ data }: { data: SalesData }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <figure className="rounded-xl border border-border bg-card p-4">
        <figcaption className="mb-2 text-sm font-semibold">Revenue by day</figcaption>
        <div className="h-64" role="img" aria-label="Line chart of daily revenue">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={rupees} width={50} />
              <Tooltip formatter={(v) => formatPrice(Number(v))} />
              <Line type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure className="rounded-xl border border-border bg-card p-4">
        <figcaption className="mb-2 text-sm font-semibold">Revenue by category</figcaption>
        <div className="h-64" role="img" aria-label="Bar chart of revenue by category">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.revenueByCategory} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={rupees} />
              <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={110} />
              <Tooltip formatter={(v) => formatPrice(Number(v))} />
              <Bar dataKey="revenue" fill="var(--primary)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  );
}
