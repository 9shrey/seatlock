import { describe, expect, it } from "vitest";
import { anon, newUser, useTestServer } from "./helpers.js";

useTestServer();

describe("auth", () => {
  it("signs up, sets an httpOnly session cookie, and knows who you are", async () => {
    const res = await anon()
      .post("/api/auth/signup")
      .send({ email: "  Asha@Example.com ", password: "password123" });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("asha@example.com");
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/seatlock_session=/);
    expect(cookie).toMatch(/HttpOnly/i);

    const me = await anon().get("/api/auth/me").set("Cookie", cookie.split(";")[0]!);
    expect(me.body.user.email).toBe("asha@example.com");
  });

  it("rejects a duplicate email, case-insensitively", async () => {
    await anon().post("/api/auth/signup").send({ email: "a@b.co", password: "password123" });
    const res = await anon().post("/api/auth/signup").send({ email: "A@B.CO", password: "password123" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("email_taken");
  });

  it("rejects short passwords and malformed emails", async () => {
    expect((await anon().post("/api/auth/signup").send({ email: "a@b.co", password: "short" })).status).toBe(400);
    expect((await anon().post("/api/auth/signup").send({ email: "nope", password: "password123" })).status).toBe(400);
  });

  it("gives the same error for an unknown email and a wrong password", async () => {
    const u = await newUser();
    const wrongPw = await anon().post("/api/auth/login").send({ email: u.email, password: "password999" });
    const noUser = await anon().post("/api/auth/login").send({ email: "ghost@test.dev", password: "password123" });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body);
  });

  it("logs in with the right password", async () => {
    const u = await newUser();
    const res = await anon().post("/api/auth/login").send({ email: u.email, password: "password123" });
    expect(res.status).toBe(200);
  });

  it("ignores a tampered session cookie", async () => {
    const res = await anon().get("/api/bookings").set("Cookie", "seatlock_session=forged.token.here");
    expect(res.status).toBe(401);
  });

  it("logs out", async () => {
    const u = await newUser();
    await u.post("/api/auth/logout").expect(204);
    expect((await u.get("/api/auth/me")).body.user).toBeNull();
  });
});
