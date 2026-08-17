const { test, expect } = require('@playwright/test');

test.describe('System 1: Auth & Settings', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  });

  test('User can login and see dashboard', async ({ page }) => {
    await page.goto('http://localhost:8080/index.html');
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();

    const loginOverlay = page.locator('#login-overlay');
    await expect(loginOverlay).toBeVisible({ timeout: 5000 });
    
    await page.locator('#btn-google-login').click();
    
    // Page will reload, we need to wait for it
    await expect(loginOverlay).toBeHidden({ timeout: 5000 });
    
    const userName = page.locator('#sidebar-user-name').first();
    await expect(userName).toContainText('Local Tester', { timeout: 5000 });
  });

  test('User can update business settings', async ({ page }) => {
    // Set localStorage BEFORE going to settings.html to prevent redirect
    await page.addInitScript(() => {
      window.localStorage.setItem('minierp_auth', JSON.stringify({
        uid: 'local-test-user',
        displayName: 'Local Tester',
        email: 'tester@local.dev'
      }));
    });
    await page.goto('http://localhost:8080/settings.html');

    // Fill the business form
    await page.locator('#b-name').fill('Thai Freelance Co., Ltd.');
    await page.locator('#b-taxid').fill('0-1234-56789-01-2');
    await page.locator('#b-phone').fill('081-999-8888');
    await page.locator('#b-address').fill('123 Bangkok Thailand');
    await page.locator('#s-wht').selectOption('0.03');

    // Save
    await page.locator('#btn-save-biz').click();

    // Assert Toast shows success
    const toast = page.locator('.toast').first();
    await expect(toast).toContainText('บันทึกข้อมูลธุรกิจเรียบร้อยแล้ว');

    // Verify it saved in localStorage
    const savedData = await page.evaluate(() => {
      const db = JSON.parse(window.localStorage.getItem('minierp_local_db') || '{}');
      return db.users['local-test-user'];
    });
    
    expect(savedData.businessName).toBe('Thai Freelance Co., Ltd.');
    expect(savedData.businessPhone).toBe('081-999-8888');
  });

  test('User cannot finalize an empty document without customer and items', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('minierp_auth', JSON.stringify({
        uid: 'local-test-user',
        displayName: 'Local Tester',
        email: 'tester@local.dev'
      }));
    });

    await page.goto('http://localhost:8080/document-editor.html');
    await page.locator('#btn-finalize').click();

    await expect(page.locator('.toast').first()).toContainText('กรุณาเลือกลูกค้าและเพิ่มรายการสินค้าอย่างน้อย 1 รายการ');
    await expect(page).toHaveURL(/document-editor\.html/);
  });

  test('User can create and finalize a valid document', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('minierp_auth', JSON.stringify({
        uid: 'local-test-user',
        displayName: 'Local Tester',
        email: 'tester@local.dev'
      }));
      window.localStorage.setItem('minierp_local_db', JSON.stringify({
        users: {
          'local-test-user': {
            businessName: 'Thai Freelance Co., Ltd.'
          }
        },
        customers: [
          {
            id: 'c1',
            uid: 'local-test-user',
            name: 'Acme Corp',
            taxId: '0-1234-56789-01-2',
            email: 'finance@acme.co.th',
            address: 'Bangkok'
          }
        ],
        products: [
          {
            id: 'p1',
            uid: 'local-test-user',
            name: 'Website Design',
            defaultPrice: 15000,
            unit: 'project'
          }
        ],
        documents: []
      }));
    });

    await page.goto('http://localhost:8080/document-editor.html');

    await page.locator('#customer-select').selectOption('c1');
    const row = page.locator('#line-items-tbody tr').first();
    await row.locator('input').nth(0).fill('Website Design');
    await row.locator('input').nth(1).fill('1');
    await row.locator('input').nth(2).fill('15000');

    await page.locator('#btn-finalize').click();

    await expect(page.locator('.toast').first()).toContainText('✅ ออกเอกสารสำเร็จ', { timeout: 5000 });
    await expect(page).toHaveURL(/documents\.html$/);
  });

  test('User cannot finalize a document when due date is before document date', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('minierp_auth', JSON.stringify({
        uid: 'local-test-user',
        displayName: 'Local Tester',
        email: 'tester@local.dev'
      }));
      window.localStorage.setItem('minierp_local_db', JSON.stringify({
        users: {
          'local-test-user': {
            businessName: 'Thai Freelance Co., Ltd.'
          }
        },
        customers: [
          {
            id: 'c1',
            uid: 'local-test-user',
            name: 'Acme Corp',
            taxId: '0-1234-56789-01-2',
            email: 'finance@acme.co.th',
            address: 'Bangkok'
          }
        ],
        products: [
          {
            id: 'p1',
            uid: 'local-test-user',
            name: 'Website Design',
            defaultPrice: 15000,
            unit: 'project'
          }
        ],
        documents: []
      }));
    });

    await page.goto('http://localhost:8080/document-editor.html');
    await page.locator('#customer-select').selectOption('c1');
    await page.locator('#doc-date').fill('2026-08-10');
    await page.locator('#doc-due').fill('2026-08-05');

    const row = page.locator('#line-items-tbody tr').first();
    await row.locator('input').nth(0).fill('Website Design');
    await row.locator('input').nth(1).fill('1');
    await row.locator('input').nth(2).fill('15000');

    await page.locator('#btn-finalize').click();

    await expect(page.locator('.toast').first()).toContainText('วันที่ครบกำหนดต้องไม่น้อยกว่าวันที่เอกสาร');
    await expect(page).toHaveURL(/document-editor\.html/);
  });

  test('User can add customer and then create a quotation from the new customer', async ({ page }) => {
    await page.addInitScript(() => {
      if (window.localStorage.getItem('minierp_local_db')) return;
      window.localStorage.setItem('minierp_auth', JSON.stringify({
        uid: 'local-test-user',
        displayName: 'Local Tester',
        email: 'tester@local.dev'
      }));
      window.localStorage.setItem('minierp_local_db', JSON.stringify({
        users: {
          'local-test-user': {
            businessName: 'Thai Freelance Co., Ltd.'
          }
        },
        customers: [],
        products: [
          {
            id: 'p1',
            uid: 'local-test-user',
            name: 'Website Design',
            defaultPrice: 15000,
            unit: 'project'
          }
        ],
        documents: []
      }));
    });

    await page.goto('http://localhost:8080/customers.html');
    await page.locator('button:has-text("เพิ่มลูกค้า")').first().click();
    await page.locator('#f-name').fill('New Customer Co');
    await page.locator('#f-taxid').fill('0-1234-56789-01-2');
    await page.locator('#f-email').fill('sales@newcustomer.co');
    await page.locator('#f-phone').fill('081-111-2222');
    await page.locator('#f-address').fill('Bangkok');
    await page.locator('#btn-save-customer').click();

    await expect(page).toHaveURL(/document-editor\.html\?customerId=/);
    await expect(page.locator('#customer-select')).toContainText('New Customer Co');

    await page.locator('#doc-type').selectOption('QUOTATION');
    const row = page.locator('#line-items-tbody tr').first();
    await row.locator('input').nth(0).fill('Website Design');
    await row.locator('input').nth(1).fill('1');
    await row.locator('input').nth(2).fill('15000');

    await page.locator('#btn-finalize').click();
    await expect(page.locator('.toast').first()).toContainText('✅ ออกเอกสารสำเร็จ', { timeout: 5000 });
    await expect(page).toHaveURL(/documents\.html$/);
  });

  test('User can mark a created document as paid from the documents list', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('minierp_auth', JSON.stringify({
        uid: 'local-test-user',
        displayName: 'Local Tester',
        email: 'tester@local.dev'
      }));
      window.localStorage.setItem('minierp_local_db', JSON.stringify({
        users: {
          'local-test-user': {
            businessName: 'Thai Freelance Co., Ltd.'
          }
        },
        customers: [
          {
            id: 'c1',
            uid: 'local-test-user',
            name: 'Acme Corp',
            taxId: '0-1234-56789-01-2',
            email: 'finance@acme.co.th',
            address: 'Bangkok'
          }
        ],
        products: [
          {
            id: 'p1',
            uid: 'local-test-user',
            name: 'Website Design',
            defaultPrice: 15000,
            unit: 'project'
          }
        ],
        documents: [
          {
            id: 'd1',
            uid: 'local-test-user',
            type: 'INVOICE',
            status: 'pending',
            number: 'INV-2026-001',
            customerId: 'c1',
            customerName: 'Acme Corp',
            customerTaxId: '0-1234-56789-01-2',
            items: [{ name: 'Website Design', qty: 1, price: 15000 }],
            subtotal: 15000,
            whtRate: 0.03,
            whtAmount: 450,
            netTotal: 14550,
            date: '2026-08-10T00:00:00.000Z',
            dueDate: '2026-08-20T00:00:00.000Z',
            notes: ''
          }
        ]
      }));
    });

    await page.goto('http://localhost:8080/documents.html');
    await page.locator('tr').filter({ hasText: 'INV-2026-001' }).locator('button[aria-label="เพิ่มเติม"]').click();
    await page.locator('#act-paid').click();

    await expect(page.locator('.toast').first()).toContainText('✅ ทำเครื่องหมายชำระแล้ว');
    await expect(page.locator('#act-paid')).toBeHidden();
  });
});
