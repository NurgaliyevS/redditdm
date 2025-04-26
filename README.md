# Reddit AI Analyzer

An automated tool that monitors specific subreddits, analyzes posts using AI to identify potential customers, and sends personalized direct messages to qualified leads.

## Features

- Automated monitoring of specified subreddits
- AI-powered post analysis using OpenAI
- Personalized direct messaging to qualified leads
- Duplicate post prevention
- Comprehensive logging system
- Docker containerization support

## Prerequisites

- Node.js 18 or higher
- Docker (optional, for containerization)
- Reddit API credentials
- OpenAI API key

## Setup

1. Clone the repository:
```bash
git clone [repository-url]
cd reddit-ai-analyzer
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example` and fill in your credentials:
```bash
cp .env.example .env
```

4. Configure your target subreddits in the `.env` file:
```
TARGET_SUBREDDITS=subreddit1,subreddit2,subreddit3
```

## Running the Application

### Local Development
```bash
npm start
```

### Docker
```bash
docker build -t reddit-ai-analyzer .
docker run -d --env-file .env reddit-ai-analyzer
```

## Configuration

The application can be configured through environment variables:

- `REDDIT_USER_AGENT`: Your Reddit API user agent
- `REDDIT_CLIENT_ID`: Reddit API client ID
- `REDDIT_CLIENT_SECRET`: Reddit API client secret
- `REDDIT_USERNAME`: Reddit account username
- `REDDIT_PASSWORD`: Reddit account password
- `OPENAI_API_KEY`: OpenAI API key
- `TARGET_SUBREDDITS`: Comma-separated list of subreddits to monitor
- `NODE_ENV`: Environment (development/production)

## Logging

Logs are stored in the `logs` directory:
- `logs/combined.log`: All application logs
- `logs/error.log`: Error logs only

## Data Storage

Processed post IDs are stored in `data/processed_posts.json` to prevent duplicate processing.

## Deployment

The application is designed to be deployed on a Hetzner server using Coolify. The Docker container includes all necessary configurations for production deployment.

## Monitoring

- Review logs daily for performance tracking
- Adjust AI criteria weekly if needed
- Review conversion metrics monthly

## License

[Your License Here] # redditdm
