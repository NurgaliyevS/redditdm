FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Create necessary directories
RUN mkdir -p logs data

# Set environment variables
ENV NODE_ENV=production

CMD ["npm", "start"] 