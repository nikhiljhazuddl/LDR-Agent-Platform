FROM mcr.microsoft.com/playwright:v1.44.0-jammy
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN npm i -g pnpm && pnpm install
COPY . .
CMD ["npx", "tsx", "src/index.ts", "run", "--file", "companies.csv"]

