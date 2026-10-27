<div align="center">

# X402 Priceboard

[![CI](https://github.com/rustemmustafingovua-byte/x402-priceboard/actions/workflows/ci.yml/badge.svg)](https://github.com/rustemmustafingovua-byte/x402-priceboard/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/x402-priceboard?color=cb3837&logo=npm)](https://www.npmjs.com/package/x402-priceboard) [![license](https://img.shields.io/badge/license-MIT-8b949e?logo=opensourceinitiative)](./LICENSE)

</div>

---

**Every x402 server answers the first request with its price, network and payee. x402-priceboard asks a list of endpoints for those terms and prints a price board — no payment, no wallet, no key.**

---

⭐ **Star us on GitHub** if this project helps you build better agents!

---

## 🚀 Быстрый старт

```bash
git clone https://github.com/rustemmustafingovua-byte/x402-priceboard
cd x402-priceboard && npm install
npx x402-priceboard https://api.venice.ai/api/v1/chat/completions
```

---

## 🎯 Демо

```bash
x402-priceboard https://api.venice.ai/api/v1/chat/completions
x402-priceboard --file endpoints.txt --markdown
```

---

## 💰 Монетизация

- **Hosted priceboard**: управляемый сервис с веб-интерфейсом и API
- **Enterprise endpoints**: private каталоги x402-сервисов для корпораций
- **Integration**: встраивание priceboard в agent-платформы и маркетплейсы
- **Data feeds**: продажа агрегированных данных о ценах x402-сервисов

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/amazing-thing`)
3. Commit your changes (`git commit -m 'feat: add amazing thing'`)
4. Push to the branch (`git push origin feat/amazing-thing`)
5. Open a Pull Request

Bug reports and feature requests are welcome on the [Issues](https://github.com/rustemmustafingovua-byte/x402-priceboard/issues) page.

MIT © rustemmustafingovua-byte
