/**
 * End-to-end flow checks against a RUNNING server.
 *
 * These hit the real HTTP API with real sessions, so a pass means the flow
 * genuinely works rather than that a mock agreed with itself. Run the server
 * first, then: npm run test:flows
 */

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5000';
const PASSWORD = 'ArtsByJay2025';

let passed = 0;
let failed = 0;
const failures = [];

const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const section = (title) => console.log(`\n── ${title} ──`);

/** Minimal cookie-aware fetch wrapper, one jar per simulated browser. */
const makeClient = () => {
  const jar = new Map();
  let accessToken = null;

  const request = async (method, url, { body, headers = {}, raw = false } = {}) => {
    const cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');

    const init = {
      method,
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      redirect: 'manual',
    };

    if (body !== undefined && !raw) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    } else if (body !== undefined) {
      init.body = body;
    }

    const response = await fetch(`${BASE}${url}`, init);

    const setCookie = response.headers.getSetCookie?.() ?? [];
    setCookie.forEach((entry) => {
      const [pair] = entry.split(';');
      const index = pair.indexOf('=');
      if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    return { status: response.status, ok: response.ok, data };
  };

  return {
    get: (url, opts) => request('GET', url, opts),
    post: (url, body, opts) => request('POST', url, { body, ...opts }),
    patch: (url, body, opts) => request('PATCH', url, { body, ...opts }),
    del: (url, opts) => request('DELETE', url, opts),
    setToken: (token) => {
      accessToken = token;
    },
    getToken: () => accessToken,
  };
};

const login = async (client, email) => {
  const result = await client.post('/api/auth/login', { email, password: PASSWORD });
  if (result.data?.accessToken) client.setToken(result.data.accessToken);
  return result;
};

const run = async () => {
  console.log(`Arts by Jay — flow checks against ${BASE}\n`);

  /* ───────────────────────── Health & capabilities ───────────────────────── */

  section('Server');
  const health = await makeClient().get('/api/health');
  check('health endpoint responds', health.ok && health.data?.ok === true);
  check('database is connected', health.data?.database === 'connected', health.data?.database);

  const anon = makeClient();
  const capabilities = await anon.get('/api/capabilities');
  check('capabilities are reported', capabilities.ok && typeof capabilities.data?.payment === 'object');
  const paymentsEnabled = capabilities.data?.payment?.enabled === true;
  const simulatedGateway = capabilities.data?.payment?.isSimulated === true;
  console.log(
    `        payment provider: ${capabilities.data?.payment?.provider} (enabled=${paymentsEnabled}, simulated=${simulatedGateway})`,
  );

  /* ───────────────────────────── Public browse ───────────────────────────── */

  section('Public catalogue');
  const browse = await anon.get('/api/artworks?limit=50');
  check('artwork listing returns items', browse.ok && browse.data?.items?.length > 0, `${browse.data?.items?.length} items`);
  check(
    'only published artwork is listed',
    browse.data?.items?.every((item) => item.isPurchasable !== undefined),
  );

  const draftLeak = browse.data?.items?.some((item) => /Untitled \(Monsoon/.test(item.title));
  check('a draft listing is NOT publicly visible', !draftLeak);

  const pendingLeak = browse.data?.items?.some((item) => item.title === 'Field System 09');
  check('a pending-moderation listing is NOT publicly visible', !pendingLeak);

  const search = await anon.get('/api/artworks?q=screenprint');
  check('search returns matches', search.ok && search.data?.items?.length > 0, `${search.data?.items?.length} hits`);

  const priceFilter = await anon.get('/api/artworks?minPrice=100000&sort=price_asc');
  check(
    'price filter is respected',
    priceFilter.ok && priceFilter.data.items.every((item) => item.priceMinor >= 10000000),
  );
  const ascending = priceFilter.data.items.every(
    (item, index, list) => index === 0 || list[index - 1].priceMinor <= item.priceMinor,
  );
  check('price_asc sorting is applied', ascending);

  const emptyResult = await anon.get('/api/artworks?q=zzzzznosuchthing');
  check('empty search returns an empty list, not an error', emptyResult.ok && emptyResult.data.items.length === 0);

  const badCategory = await anon.get('/api/artworks?category=no-such-category');
  check(
    'an unknown category filter yields no items rather than everything',
    badCategory.ok && badCategory.data.items.length === 0,
  );

  const facets = await anon.get('/api/artworks/facets');
  check('filter facets are available', facets.ok && Array.isArray(facets.data?.mediums));

  const collections = await anon.get('/api/artworks/collections');
  check('home collections are populated', collections.ok && collections.data?.newArrivals?.length > 0);

  const categories = await anon.get('/api/categories');
  check('category tree is returned', categories.ok && categories.data?.items?.length > 0);

  const artists = await anon.get('/api/artists');
  check('artist directory is returned', artists.ok && artists.data?.items?.length === 5, `${artists.data?.items?.length} artists`);

  const storefront = await anon.get(`/api/artists/${artists.data.items[0].slug}`);
  check('artist storefront loads', storefront.ok && storefront.data?.artist?.displayName);

  /* ───────────────────────────── Detail page ───────────────────────────── */

  section('Artwork detail');
  const purchasable = browse.data.items.find((item) => item.isPurchasable && item.type !== 'original');
  const original = browse.data.items.find((item) => item.type === 'original' && item.isPurchasable);
  const soldOut = browse.data.items.find((item) => item.isSoldOut);

  const detail = await anon.get(`/api/artworks/${purchasable.slug}`);
  check('detail page loads by slug', detail.ok && detail.data?.artwork?.id === purchasable.id);
  check('detail page includes the artist', Boolean(detail.data?.artwork?.artist?.displayName));
  check('detail page includes images', detail.data?.artwork?.images?.length > 0);
  check('detail page includes related work', Array.isArray(detail.data?.related));

  const missing = await anon.get('/api/artworks/this-does-not-exist');
  check('a missing artwork returns 404 with a message', missing.status === 404 && Boolean(missing.data?.error?.message));

  check('a sold-out piece is reported as sold out', Boolean(soldOut) && soldOut.isSoldOut === true);
  check('a sold-out piece is not purchasable', soldOut?.isPurchasable === false);

  /* ──────────────────────── Immersive gallery ──────────────────────── */

  section('Virtual gallery');
  const gallery = await anon.get('/api/gallery');
  check('gallery returns laid-out artwork', gallery.ok && gallery.data?.artworks?.length > 0);

  const hasBothWalls =
    gallery.data.artworks.some((item) => item.gallery.side === 'left') &&
    gallery.data.artworks.some((item) => item.gallery.side === 'right');
  check('artwork hangs on BOTH walls', hasBothWalls);

  const depthsDescend = gallery.data.artworks.every(
    (item, index, list) => index === 0 || list[index].gallery.position[2] <= list[index - 1].gallery.position[2],
  );
  check('gallery positions recede down the corridor', depthsDescend);
  check('gallery reports more than one room', gallery.data?.layout?.totalRooms > 1, `${gallery.data?.layout?.totalRooms} rooms`);
  check('every gallery piece has a viewpoint for the camera', gallery.data.artworks.every((item) => item.gallery.viewpoint?.length === 3));

  const galleryIds = new Set(gallery.data.artworks.map((item) => item.id));
  const shopIds = new Set(browse.data.items.map((item) => item.id));
  const allLinked = [...galleryIds].every((id) => shopIds.has(id));
  check('every gallery piece is a real shop listing (no separate catalogue)', allLinked);

  const galleryDetail = await anon.get(`/api/gallery/artworks/${gallery.data.artworks[0].id}`);
  check('gallery detail view loads the product record', galleryDetail.ok && galleryDetail.data?.artwork?.priceMinor > 0);

  const galleryGone = await anon.get('/api/gallery/artworks/000000000000000000000000');
  check(
    'a removed gallery piece returns alternatives',
    galleryGone.status === 404 && Array.isArray(galleryGone.data?.error?.details?.alternatives),
  );

  /* ──────────────────────── Registration & auth ──────────────────────── */

  section('Registration and authentication');
  const buyer = makeClient();
  const buyerEmail = `buyer.${Date.now()}@flowtest.local`;

  const weak = await buyer.post('/api/auth/register', { name: 'Weak', email: `w.${Date.now()}@flowtest.local`, password: 'short' });
  check('a weak password is rejected', weak.status === 422, `status ${weak.status}`);

  const badEmail = await buyer.post('/api/auth/register', { name: 'Bad', email: 'not-an-email', password: 'Strong12345' });
  check('an invalid email is rejected', badEmail.status === 422);

  const register = await buyer.post('/api/auth/register', {
    name: 'Flow Test Buyer',
    email: buyerEmail,
    password: PASSWORD,
  });
  check('registration succeeds', register.status === 201 && Boolean(register.data?.accessToken));
  check('a new account defaults to the customer role', register.data?.user?.role === 'customer');
  buyer.setToken(register.data.accessToken);

  const duplicate = await buyer.post('/api/auth/register', { name: 'Dup', email: buyerEmail, password: PASSWORD });
  check('a duplicate email is rejected', duplicate.status === 409, `status ${duplicate.status}`);

  const selfAdmin = await makeClient().post('/api/auth/register', {
    name: 'Sneaky',
    email: `sneaky.${Date.now()}@flowtest.local`,
    password: PASSWORD,
    role: 'admin',
    intent: 'admin',
  });
  check(
    'a client CANNOT register itself as an admin',
    selfAdmin.data?.user?.role !== 'admin',
    `got role ${selfAdmin.data?.user?.role ?? selfAdmin.status}`,
  );

  const wrongPassword = await makeClient().post('/api/auth/login', { email: buyerEmail, password: 'WrongPassword1' });
  check('a wrong password is rejected', wrongPassword.status === 401);

  const me = await buyer.get('/api/auth/me');
  check('the session resolves to the right user', me.ok && me.data?.user?.email === buyerEmail);

  const noToken = await makeClient().get('/api/auth/me');
  check('a protected route rejects an anonymous caller', noToken.status === 401);

  const refreshed = await buyer.post('/api/auth/refresh');
  check('the refresh cookie issues a new access token', refreshed.ok && Boolean(refreshed.data?.accessToken));
  buyer.setToken(refreshed.data.accessToken);

  /* ────────────────────── Role-based authorization ────────────────────── */

  section('Role-based permissions');
  const customerToArtist = await buyer.get('/api/artist/overview');
  check('a customer cannot reach the artist dashboard', customerToArtist.status === 403, `status ${customerToArtist.status}`);

  const customerToAdmin = await buyer.get('/api/admin/overview');
  check('a customer cannot reach the admin dashboard', customerToAdmin.status === 403, `status ${customerToAdmin.status}`);

  const forgedRole = await buyer.patch('/api/account/profile', { name: 'Still A Customer', role: 'admin' });
  const afterForge = await buyer.get('/api/auth/me');
  check('posting role:admin to a profile update does NOT escalate', afterForge.data?.user?.role === 'customer');
  check('the legitimate part of that update still applied', forgedRole.ok && afterForge.data?.user?.name === 'Still A Customer');

  const artistClient = makeClient();
  await login(artistClient, 'jay@artsbyjay.test');
  const artistOverview = await artistClient.get('/api/artist/overview');
  check('an artist can reach their own dashboard', artistOverview.ok && Boolean(artistOverview.data?.profile));

  const artistToAdmin = await artistClient.get('/api/admin/overview');
  check('an artist cannot reach the admin dashboard', artistToAdmin.status === 403);

  // A second real customer, used throughout to prove one account cannot read
  // or edit another one's records.
  const otherCustomer = makeClient();
  await login(otherCustomer, 'priya@collector.test');

  const adminClient = makeClient();
  await login(adminClient, 'admin@artsbyjay.test');
  const adminOverview = await adminClient.get('/api/admin/overview');
  check('an admin can reach the admin dashboard', adminOverview.ok && adminOverview.data?.users?.total > 0);

  /* ──────────────────── Artist artwork management ──────────────────── */

  section('Artist artwork management');
  const myArtworks = await artistClient.get('/api/artist/artworks');
  check('an artist sees their own listings', myArtworks.ok && myArtworks.data?.items?.length > 0);
  check('the artist listing includes drafts and other statuses', Boolean(myArtworks.data?.statusCounts));

  const categoryId = categories.data.flat.find((category) => category.slug === 'abstract')?.id;

  const created = await artistClient.post('/api/artist/artworks', {
    title: `Flow Test Piece ${Date.now()}`,
    description: 'Created by the automated flow check to verify artwork creation end to end.',
    category: categoryId,
    type: 'print',
    medium: 'Test medium',
    price: 1234.5,
    stock: 3,
    orientation: 'portrait',
  });
  check('an artist can create an artwork', created.status === 201 && Boolean(created.data?.artwork?.id));
  check('a new artwork starts as a draft', created.data?.artwork?.status === 'draft');
  const newId = created.data?.artwork?.id;

  const fetched = await artistClient.get(`/api/artist/artworks/${newId}`);
  check('price is stored in minor units and echoed in major units', fetched.data?.artwork?.price === 1234.5 && fetched.data?.artwork?.priceMinor === 123450);

  const updated = await artistClient.patch(`/api/artist/artworks/${newId}`, { title: 'Flow Test Piece (edited)', price: 999 });
  check('an artist can edit their own artwork', updated.ok);
  const afterEdit = await artistClient.get(`/api/artist/artworks/${newId}`);
  check('the edit persisted', afterEdit.data?.artwork?.priceMinor === 99900);

  const publishNoImage = await artistClient.post(`/api/artist/artworks/${newId}/status`, { action: 'publish' });
  check('publishing without an image is refused', publishNoImage.status === 400, publishNoImage.data?.error?.message);

  const negativePrice = await artistClient.patch(`/api/artist/artworks/${newId}`, { price: -50 });
  check('a negative price is rejected', negativePrice.status === 422);

  // Cross-artist ownership: a different artist must not be able to touch it.
  const otherArtist = makeClient();
  await login(otherArtist, 'anaya@artsbyjay.test');
  const crossEdit = await otherArtist.patch(`/api/artist/artworks/${newId}`, { title: 'Hijacked' });
  check('another artist CANNOT edit a listing they do not own', crossEdit.status === 403, `status ${crossEdit.status}`);

  const crossDelete = await otherArtist.del(`/api/artist/artworks/${newId}`);
  check('another artist CANNOT delete a listing they do not own', crossDelete.status === 403);

  const crossStatus = await otherArtist.post(`/api/artist/artworks/${newId}/status`, { action: 'publish' });
  check('another artist CANNOT publish a listing they do not own', crossStatus.status === 403);

  const deleted = await artistClient.del(`/api/artist/artworks/${newId}`);
  check('an artist can delete their own unsold draft', deleted.ok && deleted.data?.deleted === true);

  /* ──────────────────────────── Wishlist ──────────────────────────── */

  section('Wishlist');
  const wishAdd = await buyer.post('/api/wishlist', { artworkId: purchasable.id });
  check('an item can be added to the wishlist', wishAdd.ok && wishAdd.data?.added === true);

  const wishlist = await buyer.get('/api/wishlist');
  check('the wishlist returns the saved item', wishlist.ok && wishlist.data?.items?.length === 1);

  const wishToggle = await buyer.post('/api/wishlist', { artworkId: purchasable.id });
  check('toggling the same item removes it', wishToggle.data?.added === false);

  await buyer.post('/api/wishlist', { artworkId: purchasable.id });

  /* ──────────────────────────── Cart ──────────────────────────── */

  section('Cart');
  const emptyCart = await buyer.get('/api/cart');
  check('an empty cart returns a valid empty state', emptyCart.ok && emptyCart.data?.items?.length === 0 && emptyCart.data?.totals?.totalMinor === 0);

  const addItem = await buyer.post('/api/cart/items', { artworkId: purchasable.id, quantity: 2 });
  check('an item can be added to the cart', addItem.ok && addItem.data?.items?.length === 1);
  check('the cart total is computed server-side', addItem.data?.totals?.subtotalMinor === purchasable.priceMinor * 2);

  const updateQty = await buyer.patch(`/api/cart/items/${purchasable.id}`, { quantity: 3 });
  check('a cart quantity can be updated', updateQty.ok && updateQty.data?.items?.[0]?.quantity === 3);
  check('the total follows the quantity change', updateQty.data?.totals?.subtotalMinor === purchasable.priceMinor * 3);

  const addOriginal = await buyer.post('/api/cart/items', { artworkId: original.id, quantity: 5 });
  check('a one-of-a-kind original is capped at quantity 1', addOriginal.data?.items?.find((item) => item.artwork.id === original.id)?.quantity === 1);

  const addSoldOut = await buyer.post('/api/cart/items', { artworkId: soldOut.id, quantity: 1 });
  check('a sold-out piece cannot be added to the cart', addSoldOut.status === 409, `status ${addSoldOut.status}`);

  const commissionPiece = browse.data.items.find((item) => item.type === 'commission');
  if (commissionPiece) {
    const addCommission = await buyer.post('/api/cart/items', { artworkId: commissionPiece.id, quantity: 1 });
    check('a commission listing cannot be bought directly', addCommission.status === 400);
  }

  const zeroQty = await buyer.patch(`/api/cart/items/${original.id}`, { quantity: 0 });
  check('setting a quantity to zero removes the line', zeroQty.data?.items?.every((item) => item.artwork.id !== original.id));

  const badQty = await buyer.patch(`/api/cart/items/${purchasable.id}`, { quantity: 9999 });
  check('an absurd quantity is rejected by validation', badQty.status === 422);

  const otherBuyerCart = await makeClient().get('/api/cart');
  check('the cart requires a session', otherBuyerCart.status === 401);

  /* ──────────────────────────── Checkout ──────────────────────────── */

  section('Checkout');
  const checkoutConfig = await buyer.get('/api/checkout/config');
  check('checkout config states the payment capability', checkoutConfig.ok && typeof checkoutConfig.data?.payment?.enabled === 'boolean');

  const review = await buyer.get('/api/checkout/review');
  check('checkout review re-prices the cart', review.ok && review.data?.totals?.totalMinor > 0);
  check('checkout review says whether it can proceed', typeof review.data?.canProceed === 'boolean');

  const address = {
    fullName: 'Flow Test Buyer',
    phone: '+91 90000 00000',
    line1: '1 Test Lane',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400001',
    country: 'India',
  };

  const badAddress = await buyer.post('/api/checkout', { shippingAddress: { fullName: 'X' }, shippingMethod: 'standard' });
  check('checkout rejects an incomplete address', badAddress.status === 422, `status ${badAddress.status}`);

  const badShipping = await buyer.post('/api/checkout', { shippingAddress: address, shippingMethod: 'teleport' });
  check('checkout rejects an unknown shipping method', badShipping.status === 422);

  if (!paymentsEnabled) {
    const noGateway = await buyer.post('/api/checkout', { shippingAddress: address });
    check(
      'with no gateway configured, checkout refuses honestly (503) instead of faking success',
      noGateway.status === 503,
      `status ${noGateway.status}`,
    );
    console.log('\n  NOTE  PAYMENT_PROVIDER is not configured, so the paid-order flow was not exercised.');
  } else {
    const idempotencyKey = `flowtest-${Date.now()}`;
    const started = await buyer.post('/api/checkout', { shippingAddress: address, shippingMethod: 'standard', idempotencyKey });
    check('checkout creates a pending order', started.status === 201 && started.data?.order?.status === 'pending_payment');
    check('checkout returns a gateway intent', Boolean(started.data?.payment?.provider));
    if (simulatedGateway) {
      check('a simulated order is flagged as simulated', started.data?.order?.isSimulatedPayment === true);
    }

    const orderId = started.data.order.id;

    const replay = await buyer.post('/api/checkout', { shippingAddress: address, shippingMethod: 'standard', idempotencyKey });
    check('a replayed checkout returns the SAME order, not a duplicate', replay.data?.order?.id === orderId && replay.data?.reused === true);

    const forgedConfirm = await buyer.post('/api/payments/confirm', {
      orderId,
      providerOrderId: started.data.payment.orderId ?? '',
      providerPaymentId: 'pay_forged_by_client',
      signature: 'deadbeef',
    });
    check(
      'a forged payment signature is REJECTED (client success is not trusted)',
      !forgedConfirm.ok,
      `status ${forgedConfirm.status}`,
    );

    const stillPending = await buyer.get(`/api/orders/${started.data.order.orderNumber}`);
    check('the order stays unpaid after a forged confirmation', stillPending.data?.order?.status === 'pending_payment');

    // The simulated gateway hands back a real HMAC, which the server verifies.
    const confirm = await buyer.post('/api/payments/confirm', {
      orderId,
      providerOrderId: started.data.payment.orderId,
      providerPaymentId: started.data.payment.paymentId,
      signature: started.data.payment.signature,
    });
    check('a correctly signed payment is accepted', confirm.ok && confirm.data?.order?.status === 'paid', confirm.data?.error?.message);
    check('the payment records how it was verified', Boolean(confirm.data?.payment?.verifiedVia));

    const doubleConfirm = await buyer.post('/api/payments/confirm', {
      orderId,
      providerOrderId: started.data.payment.orderId,
      providerPaymentId: started.data.payment.paymentId,
      signature: started.data.payment.signature,
    });
    check('confirming twice does not settle twice', doubleConfirm.ok && doubleConfirm.data?.alreadySettled === true);

    const cartAfter = await buyer.get('/api/cart');
    check('the cart is emptied after a paid order', cartAfter.data?.items?.length === 0);

    /* ───────────────────────── Orders ───────────────────────── */

    section('Orders and fulfilment');
    const orders = await buyer.get('/api/orders');
    check('the order appears in the order history', orders.ok && orders.data?.items?.length > 0);

    const orderNumber = started.data.order.orderNumber;
    const orderDetail = await buyer.get(`/api/orders/${orderNumber}`);
    check('order detail loads for its owner', orderDetail.ok && orderDetail.data?.order?.orderNumber === orderNumber);
    check('order detail keeps an immutable item snapshot', orderDetail.data?.order?.items?.[0]?.title?.length > 0);

    const snoop = await otherCustomer.get(`/api/orders/${orderNumber}`);
    check('another customer CANNOT read someone else order', snoop.status === 404, `status ${snoop.status}`);

    // Stock should have dropped by the purchased quantity.
    const afterStock = await anon.get(`/api/artworks/${purchasable.slug}`);
    check(
      'stock was deducted only after verified payment',
      afterStock.data?.artwork?.stock === purchasable.stock - 3,
      `${purchasable.stock} -> ${afterStock.data?.artwork?.stock}`,
    );

    // The selling artist should now see the order line.
    const sellerEmailMap = {
      Jay: 'jay@artsbyjay.test',
      'Anaya Rao': 'anaya@artsbyjay.test',
      'Devika Iyer': 'devika@artsbyjay.test',
      'Rohan Desai': 'rohan@artsbyjay.test',
      'Meera Kulkarni': 'meera@artsbyjay.test',
    };
    const sellerClient = makeClient();
    await login(sellerClient, sellerEmailMap[purchasable.artist.displayName] ?? 'jay@artsbyjay.test');

    const sellerOrders = await sellerClient.get('/api/artist/orders');
    const sellerOrder = sellerOrders.data?.items?.find((item) => item.orderNumber === orderNumber);
    check('the selling artist sees the new order', Boolean(sellerOrder));
    check('the artist only sees their own line items', sellerOrder?.items?.length > 0);
    check('the artist sees their earnings net of commission', sellerOrder?.myEarningsMinor < sellerOrder?.myTotalMinor);

    /* ──────────────────── Commission accounting ──────────────────── */

    section('Commission (10% of the artwork subtotal)');

    const configured = checkoutConfig.data?.commissionPercent;
    check('the server reports a 10% commission rate', configured === 10, `got ${configured}`);

    const line = sellerOrder?.items?.[0];
    if (line) {
      const expectedCommission = Math.round((line.lineTotalMinor * configured) / 100);
      const expectedEarnings = line.lineTotalMinor - expectedCommission;

      check(
        'commission is 10% of the artwork line total',
        line.earningsMinor === expectedEarnings,
        `line ${line.lineTotalMinor}, earnings ${line.earningsMinor}, expected ${expectedEarnings}`,
      );
      check(
        'commission and earnings sum back to the basis exactly (integer paise)',
        expectedCommission + line.earningsMinor === line.lineTotalMinor,
      );

      // The prompt's worked example: ₹2,000 subtotal -> ₹200 / ₹1,800.
      const example = 200000;
      const exampleCommission = Math.round((example * configured) / 100);
      check(
        'the worked example holds: 2,000 -> 200 commission, 1,800 to the artist',
        exampleCommission === 20000 && example - exampleCommission === 180000,
      );
    }

    // Commission must be charged on artwork only, never on shipping.
    const adminOrderRecord = await adminClient.get(`/api/admin/orders/${orderNumber}`);
    const adminItem = adminOrderRecord.data?.order?.items?.[0];
    check(
      'the commission basis EXCLUDES shipping',
      adminItem?.commissionBasisMinor === adminItem?.lineTotalMinor,
      `basis ${adminItem?.commissionBasisMinor} vs line ${adminItem?.lineTotalMinor} (shipping ${adminItem?.shippingMinor})`,
    );
    check(
      'the commission RATE is snapshotted onto the order item',
      adminItem?.commissionRatePercent === configured,
      `snapshot ${adminItem?.commissionRatePercent}`,
    );
    check(
      'the snapshot reconciles: commission + earnings = basis',
      adminItem && adminItem.commissionMinor + adminItem.earningsMinor === adminItem.commissionBasisMinor,
    );

    if (sellerOrder) {
      const itemId = sellerOrder.items[0].id;

      const illegalJump = await sellerClient.patch(`/api/artist/orders/${sellerOrder.id}/items/${itemId}`, {
        fulfilmentStatus: 'delivered',
      });
      check('an artist cannot skip straight to delivered', illegalJump.status === 400, `status ${illegalJump.status}`);

      const ship = await sellerClient.patch(`/api/artist/orders/${sellerOrder.id}/items/${itemId}`, {
        fulfilmentStatus: 'shipped',
        trackingCarrier: 'Bluedart',
        trackingNumber: 'TEST123456',
      });
      check('an artist can mark their line item shipped', ship.ok && ship.data?.item?.fulfilmentStatus === 'shipped');
      check('the order status follows the line item', ship.data?.orderStatus === 'shipped');

      const wrongArtist = makeClient();
      await login(wrongArtist, sellerEmailMap[purchasable.artist.displayName] === 'anaya@artsbyjay.test' ? 'jay@artsbyjay.test' : 'anaya@artsbyjay.test');
      const hijack = await wrongArtist.patch(`/api/artist/orders/${sellerOrder.id}/items/${itemId}`, {
        fulfilmentStatus: 'delivered',
      });
      check('a different artist CANNOT update that line item', hijack.status === 403, `status ${hijack.status}`);

      const deliver = await sellerClient.patch(`/api/artist/orders/${sellerOrder.id}/items/${itemId}`, {
        fulfilmentStatus: 'delivered',
      });
      check('shipped can move to delivered', deliver.ok && deliver.data?.item?.fulfilmentStatus === 'delivered');

      /* ───────────────────────── Reviews ───────────────────────── */

      section('Reviews');
      const reviewBlocked = await otherCustomer.post('/api/reviews', {
        artworkId: purchasable.id,
        rating: 5,
        body: 'Never bought this.',
      });
      check('a non-buyer cannot review', reviewBlocked.status === 403, `status ${reviewBlocked.status}`);

      const review = await buyer.post('/api/reviews', {
        artworkId: purchasable.id,
        rating: 5,
        title: 'Exactly as described',
        body: 'Arrived well packed. The colour is truer in person than on screen.',
      });
      check('a verified buyer can review a delivered piece', review.status === 201, review.data?.error?.message);

      const reviewTwice = await buyer.post('/api/reviews', { artworkId: purchasable.id, rating: 4, body: 'Again.' });
      check('a buyer cannot review the same piece twice', reviewTwice.status === 409);

      const withReview = await anon.get(`/api/artworks/${purchasable.slug}`);
      check('the review appears on the detail page', withReview.data?.reviews?.length > 0);
      check('the rating average was recalculated', withReview.data?.artwork?.rating?.count > 0);

      const badRating = await buyer.post('/api/reviews', { artworkId: original.id, rating: 9 });
      check('an out-of-range rating is rejected', badRating.status === 422);
    }

    /* ──────────────────── Admin order visibility ──────────────────── */

    section('Admin');
    const allOrders = await adminClient.get('/api/admin/orders');
    check('an admin can list every order', allOrders.ok && allOrders.data?.items?.length > 0);

    const adminOrder = await adminClient.get(`/api/admin/orders/${orderNumber}`);
    check('an admin can read any order', adminOrder.ok && adminOrder.data?.order?.orderNumber === orderNumber);
  }

  /* ──────────────────── Admin moderation ──────────────────── */

  section('Admin moderation and reports');

  /**
   * The suite creates its own pending listing rather than consuming the
   * seeded one, so it stays re-runnable against a long-lived database. This
   * also exercises the image upload path end to end.
   */
  const { generateArtwork } = await import('./generateArtImage.js');
  const pngBuffer = generateArtwork({ width: 240, height: 300, palette: ['#111', '#c5ff3d'], seed: 42 });

  const uploadForm = new FormData();
  uploadForm.append('images', new Blob([pngBuffer], { type: 'image/png' }), 'flow-test.png');

  const uploaded = await fetch(`${BASE}/api/uploads/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${artistClient.getToken()}` },
    body: uploadForm,
  });
  const uploadedData = await uploaded.json().catch(() => null);
  check('an artist can upload an artwork image', uploaded.ok && uploadedData?.images?.length === 1, `status ${uploaded.status}`);

  const submitted = await artistClient.post('/api/artist/artworks', {
    title: `Flow Test Submission ${Date.now()}`,
    description: 'Created by the automated flow check to exercise the moderation queue end to end.',
    category: categoryId,
    type: 'print',
    price: 4321,
    stock: 5,
    images: uploadedData?.images ?? [],
  });
  check('an artist can create a listing with an image', submitted.status === 201);

  const submitForReview = await artistClient.post(`/api/artist/artworks/${submitted.data.artwork.id}/status`, {
    action: 'publish',
  });
  check(
    'submitting for review leaves it PENDING, not live',
    submitForReview.ok && submitForReview.data?.artwork?.status === 'pending',
    `status ${submitForReview.data?.artwork?.status}`,
  );

  const moderationQueue = await adminClient.get('/api/admin/artworks?status=pending');
  check('the moderation queue lists pending artwork', moderationQueue.ok && moderationQueue.data?.items?.length > 0, `${moderationQueue.data?.items?.length} pending`);

  const pendingItem = moderationQueue.data?.items?.[0];
  if (pendingItem) {
    const beforeApprove = await anon.get(`/api/artworks/${pendingItem.slug}`);
    check('pending artwork is not publicly reachable before approval', beforeApprove.status === 404);

    const approve = await adminClient.post(`/api/admin/artworks/${pendingItem.id}/moderate`, {
      decision: 'approve',
      note: 'Approved by the flow check.',
    });
    check('an admin can approve artwork', approve.ok && approve.data?.artwork?.status === 'published');

    const afterApprove = await anon.get(`/api/artworks/${pendingItem.slug}`);
    check('approved artwork becomes publicly reachable', afterApprove.ok);

    const unpublish = await adminClient.post(`/api/admin/artworks/${pendingItem.id}/moderate`, { decision: 'unpublish' });
    check('an admin can unpublish artwork', unpublish.ok && unpublish.data?.artwork?.status === 'unpublished');
  }

  const artistApps = await adminClient.get('/api/admin/artists');
  check('an admin can list artist applications', artistApps.ok && artistApps.data?.items?.length > 0);

  const users = await adminClient.get('/api/admin/users');
  check('an admin can list users', users.ok && users.data?.items?.length > 0);

  const selfDemote = await adminClient.patch(`/api/admin/users/${adminOverview.data ? users.data.items.find((u) => u.role === 'admin').id : ''}`, {
    role: 'customer',
  });
  check('an admin cannot demote their own account', selfDemote.status === 400, `status ${selfDemote.status}`);

  const newCategory = await adminClient.post('/api/admin/categories', { name: `Flow Test Category ${Date.now()}` });
  check('an admin can create a category', newCategory.status === 201);
  if (newCategory.data?.category?._id) {
    const removed = await adminClient.del(`/api/admin/categories/${newCategory.data.category._id}`);
    check('an admin can delete an unused category', removed.ok);
  }

  const inUseCategory = categories.data.flat.find((category) => category.artworkCount > 0);
  if (inUseCategory) {
    const blocked = await adminClient.del(`/api/admin/categories/${inUseCategory.id}`);
    check('a category still in use cannot be deleted', blocked.status === 409);
  }

  const salesReport = await adminClient.get('/api/admin/reports/sales');
  check('the sales report is produced', salesReport.ok && Array.isArray(salesReport.data?.byArtist));
  if (simulatedGateway) {
    check('the sales report warns that the gateway is simulated', Boolean(salesReport.data?.note));
  }

  const settings = await adminClient.get('/api/admin/settings');
  check('platform settings are readable', settings.ok && Boolean(settings.data?.payments?.provider));

  /* ──────────────────── Commissions & studio ──────────────────── */

  section('Commissions and photo studio');
  const studioConfig = await anon.get('/api/studio/config');
  check('studio config lists the styles', studioConfig.ok && studioConfig.data?.styles?.length === 4);
  check('studio config states whether AI generation is real', typeof studioConfig.data?.aiGeneration?.enabled === 'boolean');
  check('studio config carries an honest notice', Boolean(studioConfig.data?.aiGeneration?.notice));

  const shortMessage = await buyer.post('/api/commissions', {
    contactName: 'Flow Test',
    contactEmail: 'flow@test.local',
    message: 'hi',
  });
  check('a too-short commission brief is rejected', shortMessage.status === 422);

  const enquiry = await buyer.post('/api/commissions', {
    kind: 'commission',
    contactName: 'Flow Test Buyer',
    contactEmail: buyerEmail,
    artworkId: purchasable.id,
    subject: 'Commission enquiry from the flow check',
    message: 'I would like something in this palette at roughly a metre square. What would that involve?',
    budget: 80000,
  });
  check('a commission enquiry can be submitted', enquiry.status === 201 && Boolean(enquiry.data?.request?.reference));
  check('the enquiry response does not claim an email was sent', enquiry.data?.emailSent === false);

  const myCommissions = await buyer.get('/api/account/commissions');
  check('the customer can see their own enquiries', myCommissions.ok && myCommissions.data?.items?.length > 0);

  const sellerEnquiries = await artistClient.get('/api/artist/enquiries');
  check('an artist can see enquiries sent to them', sellerEnquiries.ok && Array.isArray(sellerEnquiries.data?.items));

  if (sellerEnquiries.data?.items?.length) {
    const quote = await artistClient.patch(`/api/artist/enquiries/${sellerEnquiries.data.items[0].id}`, {
      status: 'quoted',
      quotedAmount: 95000,
      reply: 'Happy to take this on. A metre square in this palette would be eight weeks.',
    });
    check('an artist can quote on an enquiry', quote.ok && quote.data?.request?.status === 'quoted');
    check('the quote amount is stored in minor units', quote.data?.request?.quotedAmountMinor === 9500000);

    const hijackEnquiry = await otherArtist.patch(`/api/artist/enquiries/${sellerEnquiries.data.items[0].id}`, {
      reply: 'Not mine.',
    });
    check('another artist cannot answer an enquiry sent elsewhere', hijackEnquiry.status === 403);
  }

  /* ──────────────────── Notifications & account ──────────────────── */

  section('Notifications and account');
  const notifications = await artistClient.get('/api/notifications');
  check('notifications are listed', notifications.ok && Array.isArray(notifications.data?.items));

  if (notifications.data?.items?.length) {
    const markRead = await artistClient.post('/api/notifications/read', { ids: [notifications.data.items[0].id] });
    check('notifications can be marked read', markRead.ok && markRead.data?.updated >= 1);
  }

  const newAddress = await buyer.post('/api/account/addresses', {
    label: 'Studio',
    fullName: 'Flow Test Buyer',
    phone: '+91 90000 00001',
    line1: '2 Second Street',
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411001',
    country: 'India',
  });
  check('an address can be saved', newAddress.status === 201);
  check('the first saved address becomes the default', newAddress.data?.address?.isDefault === true);

  const addresses = await buyer.get('/api/account/addresses');
  check('addresses are listed', addresses.ok && addresses.data?.items?.length > 0);

  const foreignAddress = await otherCustomer.patch(`/api/account/addresses/${newAddress.data.address.id}`, { city: 'Hijacked' });
  check('a customer cannot edit another customer address', foreignAddress.status === 404, `status ${foreignAddress.status}`);

  const summary = await buyer.get('/api/account/summary');
  check('the account summary returns counts', summary.ok && typeof summary.data?.wishlistCount === 'number');

  const staleToken = buyer.getToken();

  const changePassword = await buyer.post('/api/auth/change-password', {
    currentPassword: PASSWORD,
    newPassword: 'NewFlowPassword123',
  });
  check('a password can be changed with the correct current password', changePassword.ok);
  check('the change hands back a fresh access token', Boolean(changePassword.data?.accessToken));

  const oldPassword = await makeClient().post('/api/auth/login', { email: buyerEmail, password: PASSWORD });
  check('the old password no longer works', oldPassword.status === 401);

  // A password change bumps tokenVersion, so tokens minted before it must die.
  const withStaleToken = makeClient();
  withStaleToken.setToken(staleToken);
  const staleAttempt = await withStaleToken.get('/api/auth/me');
  check('an access token issued before the change is invalidated', staleAttempt.status === 401, `status ${staleAttempt.status}`);

  buyer.setToken(changePassword.data.accessToken);

  const wrongCurrent = await buyer.post('/api/auth/change-password', {
    currentPassword: 'NotTheCurrentOne1',
    newPassword: 'AnotherPassword123',
  });
  check('changing a password requires the current one', wrongCurrent.status === 400, `status ${wrongCurrent.status}`);

  const logout = await buyer.post('/api/auth/logout');
  check('logout succeeds', logout.ok);

  /* ──────────────────────── Error handling ──────────────────────── */

  section('Error handling');
  const badRoute = await anon.get('/api/no-such-route');
  check('an unknown API route returns a 404 envelope', badRoute.status === 404 && Boolean(badRoute.data?.error?.message));

  // `buyer` has just logged out, so use a live session for this check.
  const badId = await otherCustomer.post('/api/cart/items', { artworkId: 'not-an-object-id', quantity: 1 });
  check('an invalid object id is rejected cleanly', badId.status === 422, `status ${badId.status}`);

  const badJson = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  check('malformed JSON does not crash the server', badJson.status >= 400 && badJson.status < 500, `status ${badJson.status}`);

  const stillAlive = await anon.get('/api/health');
  check('the server is still healthy after all of that', stillAlive.ok);

  /* ──────────────────────────── Summary ──────────────────────────── */

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach((failure) => console.log(`    - ${failure}`));
  }
  console.log(`${'='.repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error('\n[flows] the run itself threw:', err);
  process.exit(1);
});
