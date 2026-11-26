import { withAuth } from "next-auth/middleware";

/** Route guards: account pages need a session; /admin needs the ADMIN role. */
export default withAuth({
  callbacks: {
    authorized: ({ req, token }) => {
      if (!token) return false;
      if (req.nextUrl.pathname.startsWith("/admin")) return token.role === "ADMIN";
      return true;
    },
  },
  pages: { signIn: "/login" },
});

export const config = { matcher: ["/checkout", "/orders/:path*", "/wishlist", "/admin/:path*"] };
